"""Deepgram Aura's handwritten HTTP and byte-native WebSocket protocols."""

import asyncio
import json
import math
import os
import sys
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from typing import NoReturn, Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.deepgram import TtsRequest, TtsRequestAura1StreamingTextVoiceTextItem as Input
from speechswitch.generated.deepgram_output import SynthesisItem, StreamEvent
from speechswitch.generated.validators.deepgram import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping
from speechswitch.websocket import WebSocketLike, connect_websocket


@runtime_checkable
class _Closable(Protocol):
    def aclose(self) -> Awaitable[None]: ...


@asynccontextmanager
async def _closing[T: _Closable](resource: T) -> AsyncIterator[T]:
    try:
        yield resource
    except BaseException:
        try:
            await resource.aclose()
        except Exception:
            pass
        raise
    else:
        await resource.aclose()


def _number(value: float) -> str:
    return str(int(value)) if value == int(value) else str(value)


def _url(request: TtsRequest, endpoint: str, streaming: bool) -> str:
    try:
        url = urlsplit(endpoint)
        if url.scheme not in (("ws", "wss") if streaming else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or c == "\\" for c in endpoint):
            raise ValueError
        _ = url.port
    except ValueError:
        raise TypeError("Invalid Deepgram endpoint URL") from None
    output = request["output"]
    format = output["format"]
    encoding = "linear16" if format == "pcm" else output.get("sample_encoding", "signed_integer_16") if format == "wav" else "opus" if format == "ogg_opus" else format
    if encoding == "signed_integer_16":
        encoding = "linear16"
    # Endpoint extensions may keep unrelated query values, not override the schema
    # or move a credential from the native authorization header into the URL.
    owned = {"model", "encoding", "container", "sample_rate", "bit_rate", "speed", "mip_opt_out", "tag", "api_key", "access_token"}
    query = [(k, v) for k, v in parse_qsl(url.query, keep_blank_values=True) if k not in owned]
    model = "aura" if request["model"] == "aura-1" else "aura-2"
    query.extend([("model", f"{model}-{request['voice']}-{request['language']}"), ("encoding", encoding)])
    if not streaming:
        if format in ("wav", "pcm", "mulaw", "alaw", "ogg_opus"):
            query.append(("container", "wav" if format == "wav" else "ogg" if format == "ogg_opus" else "none"))
    if "sample_rate_hz" in output and format not in ("mp3", "ogg_opus", "aac"):
        query.append(("sample_rate", _number(output["sample_rate_hz"])))
    if output["format"] == "mp3" or output["format"] == "ogg_opus" or output["format"] == "aac":
        if "bit_rate_bps" in output:
            query.append(("bit_rate", _number(output["bit_rate_bps"])))
    if "speed" in request:
        query.append(("speed", _number(request["speed"])))
    if "model_improvement_opt_out" in request:
        query.append(("mip_opt_out", "true" if request["model_improvement_opt_out"] else "false"))
    for tag in request.get("tags", ()):
        query.append(("tag", tag))
    return urlunsplit((url.scheme, url.netloc, url.path if streaming else url.path.rstrip("/") + "/v1/speak", urlencode(query), ""))


def _invalid_constant(_: str) -> NoReturn:
    raise TypeError("Deepgram returned invalid JSON")


def _decode(frame: object, limit: int) -> bytes | str | StreamEvent:
    if not isinstance(frame, (str, bytes)):
        raise TypeError("Deepgram returned an unsupported WebSocket frame")
    if len(frame.encode("utf-8") if isinstance(frame, str) else frame) > limit:
        raise TypeError("Deepgram message exceeds max_message_bytes")
    if isinstance(frame, bytes):
        return frame
    try:
        value: object = json.loads(frame, parse_int=float, parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("Deepgram returned invalid JSON") from None
    if not is_mapping(value):
        raise TypeError("Deepgram returned an invalid WebSocket event")
    kind = value.get("type")
    if kind in ("Warning", "Error"):
        code, description = value.get("code"), value.get("description")
        if not isinstance(code, str) or not isinstance(description, str):
            raise TypeError("Deepgram returned an invalid error event")
        raise TypeError(f"Deepgram {kind} {code}: {description}")
    trace = value.get("request_id")
    if kind == "Metadata" and isinstance(trace, str):
        return trace
    sequence = value.get("sequence_id")
    if kind in ("Flushed", "Cleared") and not isinstance(sequence, bool) and isinstance(sequence, (int, float)) and math.isfinite(sequence) and 0 <= sequence <= 9007199254740991 and sequence == math.floor(sequence):
        if kind == "Cleared":
            return {"event": "clear", "sequence_id": sequence}
        return {"event": "done", "sequence_id": sequence}
    raise TypeError("Deepgram returned an invalid WebSocket event")


async def _live(text: AsyncIterable[Input], socket: WebSocketLike, validate: InputValidator, limit: int) -> AsyncGenerator[SynthesisItem]:
    source: AsyncIterator[Input] | None = None
    pending_input: asyncio.Future[tuple[bool, Input | None]] | None = None
    pending_output: asyncio.Future[str | bytes] | None = None
    pending_send: asyncio.Future[None] | None = None
    held: tuple[bool, Input | None] | None = None
    input_done, has_text, flushing, clearing = False, False, False, False
    trace: str | None = None
    prefer_output = True

    async def pull(source: AsyncIterator[Input]) -> tuple[bool, Input | None]:
        try:
            return False, await anext(source)
        except StopAsyncIteration:
            return True, None

    async def send(message: dict[str, object]) -> None:
        encoded = json.dumps(message, separators=(",", ":"), allow_nan=False)
        if len(encoded.encode("utf-8")) > limit:
            raise TypeError("Deepgram message exceeds max_message_bytes")
        await socket.send(encoded)

    try:
        source = aiter(text)
        pending_input = asyncio.ensure_future(pull(source))
        pending_output = asyncio.ensure_future(socket.receive())
        while True:
            if input_done and not has_text and not flushing and not clearing and pending_send is None:
                await send({"type": "Close"})
                return
            if held is not None and not flushing and not clearing and pending_send is None:
                pending_input = asyncio.get_running_loop().create_future()
                pending_input.set_result(held)
                held = None
            tasks = [task for task in (pending_output, pending_send, pending_input) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            ordered = [("output", pending_output), ("send", pending_send), ("input", pending_input)] if prefer_output else [("send", pending_send), ("input", pending_input), ("output", pending_output)]
            kind = next(kind for kind, task in ordered if task is not None and task in completed)
            prefer_output = kind != "output"
            if kind == "output":
                assert pending_output is not None
                try:
                    frame = pending_output.result()
                except StopAsyncIteration:
                    raise TypeError("Deepgram WebSocket closed before input or pending synthesis completed") from None
                message = _decode(frame, limit)
                pending_output = asyncio.ensure_future(socket.receive())
                if isinstance(message, bytes):
                    if message and not clearing:
                        yield message
                elif isinstance(message, str):
                    trace = message
                elif message["event"] == "clear":
                    if not clearing:
                        raise TypeError("Unexpected Deepgram Cleared acknowledgement")
                    clearing, flushing = False, False
                    yield message
                else:
                    if clearing:
                        continue
                    if not flushing:
                        raise TypeError("Unexpected Deepgram Flushed acknowledgement")
                    flushing = False
                    if trace is None:
                        yield message
                    else:
                        yield {"event": "done", "sequence_id": message["sequence_id"], "trace_id": trace}
            elif kind == "send":
                assert pending_send is not None
                pending_send.result()
                pending_send = None
                if not input_done and held is None:
                    pending_input = asyncio.ensure_future(pull(source))
            else:
                assert pending_input is not None
                done, item = pending_input.result()
                pending_input = None
                if not done:
                    validate(item)
                # Clear can interrupt a flush; hold subsequent text until the
                # native acknowledgement so pre-clear audio cannot leak through.
                if clearing or (flushing and (done or isinstance(item, str) or item is not None and item["command"] == "flush")):
                    held = (done, item)
                    continue
                if done:
                    input_done = True
                    if has_text:
                        has_text, flushing = False, True
                        pending_send = asyncio.ensure_future(send({"type": "Flush"}))
                elif isinstance(item, str):
                    if item:
                        has_text = True
                        pending_send = asyncio.ensure_future(send({"type": "Speak", "text": item}))
                    else:
                        pending_input = asyncio.ensure_future(pull(source))
                elif item is not None and item["command"] == "clear":
                    has_text, clearing = False, True
                    pending_send = asyncio.ensure_future(send({"type": "Clear"}))
                elif has_text:
                    has_text, flushing = False, True
                    pending_send = asyncio.ensure_future(send({"type": "Flush"}))
                else:
                    pending_input = asyncio.ensure_future(pull(source))
    finally:
        original = sys.exception()
        cleanup_error: BaseException | None = None
        try:
            await socket.aclose()
        except BaseException as error:
            cleanup_error = error
        tasks = [task for task in (pending_input, pending_output, pending_send) if task is not None]
        for task in tasks:
            task.cancel()
        cleanup: list[Awaitable[object]] = list(tasks)
        await asyncio.gather(*cleanup, return_exceptions=True)
        if isinstance(source, _Closable):
            try:
                await source.aclose()
            except BaseException as error:
                if cleanup_error is None:
                    cleanup_error = error
        if original is None and cleanup_error is not None:
            raise cleanup_error


async def _audio(body: AudioStream) -> AsyncGenerator[SynthesisItem]:
    received = False
    async with _closing(body):
        async for chunk in body:
            received = True
            yield chunk
            await asyncio.sleep(0)
        if not received:
            raise TypeError("Deepgram returned no audio bytes")


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     web_socket: WebSocketLike | None = None, base_url: str = "https://api.deepgram.com",
                     web_socket_url: str = "wss://api.deepgram.com/v1/speak", timeout_ms: int | None = None,
                     max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Own a synthesis context, including idle time between pulls.

    HTTP needs an injected async transport; streaming input uses native WebSocket
    header auth unless overridden. Producers/transports must honor cancellation.
    Always use async with; breaking async for alone does not close its iterator.
    """
    validate = validate_request(request)
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Deepgram timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("Deepgram synthesis deadline expired")
    if type(max_message_bytes) is not int or max_message_bytes <= 0:
        raise TypeError("Deepgram max_message_bytes must be a positive integer")
    entry = auth.get("deepgram") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_DEEPGRAM_API_KEY", os.environ.get("DEEPGRAM_API_KEY"))
    if not key:
        raise TypeError("Missing auth.deepgram.apiKey configuration")
    text = request["text"]
    streaming = not isinstance(text, str)
    target = _url(request, web_socket_url if streaming else base_url, streaming)
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if isinstance(text, str):
                if transport is None:
                    raise TypeError("Deepgram HTTP transport is required")
                response = await transport.send(HttpRequest("POST", target, {"authorization": f"Token {key}", "content-type": "application/json"}, json.dumps({"text": text}, separators=(",", ":"), allow_nan=False).encode("utf-8")))
                async with _closing(AudioStream(response.body)) as body:
                    if not 200 <= response.status < 300:
                        raise TypeError(f"Deepgram returned HTTP {response.status}")
                    content_type = next((v for k, v in response.headers.items() if k.lower() == "content-type"), "").split(";", 1)[0].strip().lower()
                    if content_type and not content_type.startswith("audio/") and content_type != "application/octet-stream":
                        raise TypeError("Deepgram returned an unexpected audio content type")
                    async with _closing(_audio(body)) as items:
                        yield items
            elif web_socket is not None:
                async with _closing(web_socket):
                    async with _closing(_live(text, web_socket, validate, max_message_bytes)) as items:
                        yield items
            else:
                async with connect_websocket(target, headers={"Authorization": f"Token {key}"}, max_message_bytes=max_message_bytes) as socket:
                    async with _closing(_live(text, socket, validate, max_message_bytes)) as items:
                        yield items
    except TimeoutError:
        if deadline.expired():
            raise TimeoutError("Deepgram synthesis deadline expired") from None
        raise
