"""Typecast's handwritten HTTP protocol over schema-generated public contracts."""

import asyncio
import base64
import json
import math
import os
import re
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import aclosing, asynccontextmanager
from typing import Literal, NoReturn
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.typecast import TtsRequest, TtsRequestObjectSegmentsItem
from speechswitch.generated.typecast_output import SynthesisItem, TypecastEnvelope, TypecastEnvelopeTimestampsItem
from speechswitch.generated.validators.typecast import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpResponse, HttpTransport
from speechswitch.validation import code_point_length, is_mapping, is_sequence


_LANGUAGES = {
    "ar": "ara", "bg": "bul", "cs": "ces", "da": "dan", "de": "deu", "el": "ell", "en": "eng",
    "fi": "fin", "fr": "fra", "hr": "hrv", "id": "ind", "it": "ita", "ja": "jpn", "ko": "kor",
    "ms": "msa", "nl": "nld", "pl": "pol", "pt": "por", "ro": "ron", "ru": "rus", "sk": "slk",
    "es": "spa", "sv": "swe", "ta": "tam", "tl": "tgl", "uk": "ukr", "zh": "zho", "bn": "ben",
    "hi": "hin", "hu": "hun", "nan": "nan", "no": "nor", "pa": "pan", "th": "tha", "tr": "tur",
    "vi": "vie", "yue": "yue",
}


class TypecastError(Exception):
    def __init__(self, status: int) -> None:
        self.status = status
        super().__init__(f"Typecast returned HTTP {status}")


def _wire_speech(request: TtsRequest | TtsRequestObjectSegmentsItem, format: str) -> dict[str, object]:
    wire: dict[str, object] = {"voice_id": request.get("voice"), "text": request.get("text"), "model": request.get("model")}
    language = request.get("language", "auto")
    if language != "auto":
        wire["language"] = _LANGUAGES[language]
    seed = request.get("random_seed")
    if seed is not None:
        wire["seed"] = int(seed)
    if request.get("emotion") == "auto":
        before, after = request.get("context_before"), request.get("context_after")
        prompt: dict[str, object] = {"emotion_type": "smart", "previous_text": before["text"] if before is not None else "",
                                   "next_text": after["text"] if after is not None else ""}
    else:
        prompt = {"emotion_preset": request.get("emotion", "normal"), "emotion_intensity": request.get("emotion_intensity", 1)}
        if request.get("model") == "ssfm-v30":
            prompt["emotion_type"] = "preset"
    wire["prompt"] = prompt
    output: dict[str, object] = {"audio_format": format, "audio_pitch": int(request.get("pitch_semitones", 0)), "audio_tempo": request.get("speed", 1)}
    volume = request.get("volume_scale")
    if volume is not None:
        percent = volume * 100
        integer = math.floor(percent)
        # Match Math.round, including ties and the representable value just below a tie.
        output["volume"] = integer + int(percent - integer >= 0.5)
    loudness = request.get("target_loudness_lufs")
    if loudness is not None:
        output["target_lufs"] = loudness
    wire["output"] = output
    return wire


def _invalid_constant(_: str) -> NoReturn:
    raise ValueError("Non-JSON numeric constant")


def _seconds(value: object, message: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(message)
    try:
        result = float(value)
    except OverflowError:
        raise TypeError(message) from None
    if not math.isfinite(result * 1000) or result < 0:
        raise TypeError(message)
    return result


def _timestamps(data: bytearray, format: str, words: bool, characters: bool) -> TypecastEnvelope:
    try:
        value: object = json.loads(data.decode("utf-8-sig"), parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("Invalid Typecast timestamp response") from None
    if not is_mapping(value):
        raise TypeError("Invalid Typecast timestamp response")
    duration = _seconds(value.get("audio_duration"), "Invalid Typecast timestamp audio metadata")
    if value.get("audio_format") != format:
        raise TypeError("Invalid Typecast timestamp audio metadata")
    encoded = value.get("audio")
    if not isinstance(encoded, str):
        raise TypeError("Invalid Typecast base64 audio")
    try:
        audio = base64.b64decode(encoded, validate=True)
        if not audio or base64.b64encode(audio).decode("ascii") != encoded:
            raise ValueError
    except ValueError:
        raise TypeError("Invalid Typecast base64 audio") from None
    marks: list[TypecastEnvelopeTimestampsItem] = []
    tracks: tuple[tuple[str, Literal["word", "character"], bool], ...] = (("words", "word", words), ("characters", "character", characters))
    for key, kind, required in tracks:
        entries = value.get(key)
        if key in value and entries is None and not required:
            continue
        if not is_sequence(entries):
            raise TypeError(f"Typecast omitted {key} alignment")
        for entry in entries:
            if not is_mapping(entry):
                raise TypeError("Invalid Typecast alignment segment")
            text = entry.get("text")
            start = _seconds(entry.get("start"), "Invalid Typecast alignment interval")
            end = _seconds(entry.get("end"), "Invalid Typecast alignment interval")
            if not isinstance(text, str) or end < start:
                raise TypeError("Invalid Typecast alignment interval")
            if required:
                marks.append({"kind": kind, "value": text, "start_time_ms": start * 1000, "end_time_ms": end * 1000})
    return {"correlation": "chunk", "audio": audio, "duration_ms": duration * 1000, "timestamps": tuple(marks)}


async def _items(response: HttpResponse, body: AudioStream, format: str, words: bool,
                 characters: bool, limit: int) -> AsyncGenerator[SynthesisItem]:
    if not 200 <= response.status < 300:
        raise TypecastError(response.status)
    media = next((value for key, value in response.headers.items() if key.lower() == "content-type"), "").split(";", 1)[0].strip().lower()
    timed = words or characters
    expected = "application/json" if timed else "audio/wav" if format == "wav" else "audio/mpeg"
    if media and media != expected and (timed or media != "application/octet-stream"):
        raise TypeError("Typecast returned an unexpected content type")
    if timed:
        data = bytearray()
        async for chunk in body:
            if len(chunk) > limit - len(data):
                raise TypeError("Typecast timestamp response exceeds max_timestamp_response_bytes")
            data.extend(chunk)
            # Injected bodies may finish reads synchronously; keep cancellation/deadlines cooperative.
            await asyncio.sleep(0)
        yield _timestamps(data, format, words, characters)
    else:
        received = False
        async for chunk in body:
            received = True
            yield chunk
            await asyncio.sleep(0)
        if not received:
            raise TypeError("Typecast returned no audio")
    # A timestamp envelope can be followed by cancellation without another body read.
    await asyncio.sleep(0)
    yield {"event": "done"}


@asynccontextmanager
async def synthesize(request: TtsRequest, *, transport: HttpTransport, auth: Auth | None = None,
                     base_url: str = "https://api.typecast.ai", protocol: Literal["stream", "http"] | None = None,
                     timeout_ms: int | None = None, max_timestamp_response_bytes: int = 128 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with, including for early exit. The deadline covers the entire context.

    The injected transport returns at headers, honors cancellation and rejects
    redirects/retries. Protocol selects streaming or ordinary upstream HTTP;
    neither accepts incremental text or native clear commands.
    """
    validate_request(request)
    key = (auth or {}).get("typecast", {}).get("api_key")
    if key is None:
        key = os.environ.get("SPEECHSWITCH_TYPECAST_API_KEY", os.environ.get("TYPECAST_API_KEY"))
    if not key:
        raise TypeError("Missing auth.typecast.apiKey configuration")
    if any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise TypeError("Typecast API key must contain only visible ASCII characters")
    if protocol not in (None, "stream", "http"):
        raise TypeError("Typecast protocol must be stream or http")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Typecast timeout_ms must be an integer between 0 and 2147483647")
    if type(max_timestamp_response_bytes) is not int or not 0 < max_timestamp_response_bytes <= 9007199254740991:
        raise TypeError("Typecast max_timestamp_response_bytes must be a positive safe integer")
    output = request.get("output")
    format = output["format"] if output is not None else "wav"
    granularity = request.get("timestamp_granularity")
    words = granularity == "word" or granularity is not None and not isinstance(granularity, str) and "word" in granularity
    characters = granularity == "character" or granularity is not None and not isinstance(granularity, str) and "character" in granularity
    segments = request.get("segments")
    rate = output.get("sample_rate_hz") if output is not None else None
    full = segments is not None or granularity is not None or request.get("volume_scale") is not None or format == "wav" and rate == 44100
    mode = protocol if protocol is not None else "http" if full else "stream"
    if full and mode == "stream":
        raise TypeError("Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis")
    if mode == "http" and format == "wav" and rate == 32000:
        raise TypeError("Typecast ordinary WAV uses 44100 Hz, not 32000 Hz")
    operation = "/with-timestamps" if words or characters else "/stream" if mode == "stream" else ""
    if segments is not None:
        text_length, pauses, speech = 0, 0.0, False
        native: list[dict[str, object]] = []
        for segment in segments:
            if segment["kind"] == "speech":
                text_length += code_point_length(segment["text"])
                speech = True
                native.append({"type": "tts", **_wire_speech(segment, format)})
            else:
                pauses += segment["pause_ms"]
                seconds = segment["pause_ms"] / 1000
                if seconds == 0:
                    raise TypeError("Typecast pause cannot be represented as positive seconds")
                native.append({"type": "pause", "duration_seconds": seconds})
        if not speech or text_length > 2000 or pauses > 60000:
            raise TypeError("Typecast composition requires speech, at most 2000 total text code points and at most 60000 ms total pauses")
        payload: dict[str, object] = {"segments": native}
        operation = "/compose"
    else:
        payload = _wire_speech(request, format)
    try:
        url = urlsplit(base_url)
        if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in base_url) or re.search(r"%(?![0-9a-fA-F]{2})", base_url):
            raise ValueError
        _ = url.port
    except ValueError:
        raise TypeError("Typecast endpoint must be HTTP(S) without credentials, fragments or invalid escapes") from None
    query = [(key, value) for key, value in parse_qsl(url.query, keep_blank_values=True) if key != "granularity"]
    if words != characters:
        query.append(("granularity", "word" if words else "char"))
    endpoint = urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + "/v1/text-to-speech" + operation, urlencode(query), ""))
    headers = {"X-API-KEY": key, "Content-Type": "application/json", "Accept": "application/json" if words or characters else "audio/wav" if format == "wav" else "audio/mpeg"}
    encoded = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if timeout_ms == 0:
        raise TimeoutError("Typecast synthesis deadline expired")
    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000):
        response = await transport.send(HttpRequest("POST", endpoint, headers, encoded))
        body = AudioStream(response.body)
        try:
            async with aclosing(_items(response, body, format, words, characters, max_timestamp_response_bytes)) as items:
                yield items
        except BaseException:
            try:
                await body.aclose()
            except Exception:
                pass
            raise
        finally:
            await body.aclose()
