"""Google Cloud TTS: generated wire clients, native gRPC, canonical request types."""

import asyncio
import base64
import json
import os
import sys
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Sequence
from contextlib import asynccontextmanager
from typing import Protocol, runtime_checkable
from urllib.parse import urlsplit, urlunsplit

from speechswitch.clients import google_grpc as proto, google_grpc_beta as proto_beta
from speechswitch.clients import google_rest as rest, google_rest_beta as rest_beta
from speechswitch.generated.auth import Auth, AuthGoogle
from speechswitch.generated.google import TtsRequest, TtsRequestTurnsTurnsItem as Turn
from speechswitch.generated.validators.google import REQUEST_DEFAULTS, validate_request
from speechswitch.grpc import GrpcLike, connect_grpc
from speechswitch.http import AudioStream, HttpResponse, HttpTransport
from speechswitch.validation import InputValidator, is_mapping


class GoogleError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        super().__init__(f"Google {status_code}: {message}")


_PHONETICS: dict[str, proto.CustomPronunciationParamsPhoneticEncoding] = {
    "ipa": "PHONETIC_ENCODING_IPA", "x_sampa": "PHONETIC_ENCODING_X_SAMPA",
    "japanese_yomigana": "PHONETIC_ENCODING_JAPANESE_YOMIGANA", "pinyin": "PHONETIC_ENCODING_PINYIN",
}
_CATEGORIES: dict[str, proto.AdvancedVoiceOptionsHarmCategory] = {
    "hate_speech": "HARM_CATEGORY_HATE_SPEECH", "dangerous_content": "HARM_CATEGORY_DANGEROUS_CONTENT",
    "harassment": "HARM_CATEGORY_HARASSMENT", "sexually_explicit": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
}
_THRESHOLDS: dict[str, proto.AdvancedVoiceOptionsHarmBlockThreshold] = {
    "low": "BLOCK_LOW_AND_ABOVE", "medium": "BLOCK_MEDIUM_AND_ABOVE", "high": "BLOCK_ONLY_HIGH", "none": "BLOCK_NONE", "off": "OFF",
}


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


def _check_text(text: str, limit: int) -> None:
    try:
        data = text.encode("utf-8")
    except UnicodeEncodeError:
        # Match TextEncoder's replacement of unpaired UTF-16 surrogates.
        data = text.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "replace").encode("utf-8")
    if len(data) > limit:
        raise TypeError(f"Google input exceeds {limit} UTF-8 bytes")


def _check_turns(turns: Sequence[Turn], aliases: set[str], limit: int) -> None:
    # A nonempty array alternative inside array|AsyncIterable is not currently
    # expressible with specgen's property-boundary array annotations.
    if not turns:
        raise TypeError("Google dialogue turns must not be empty")
    for turn in turns:
        if turn["speaker"] not in aliases:
            raise TypeError(f"Google dialogue references an unknown speaker: {turn['speaker']}")
    _check_text("".join(turn["text"] for turn in turns), limit)


def _voice(request: TtsRequest) -> proto.VoiceSelectionParams:
    if request["model"] == "chirp-3-hd":
        return {"language_code": request["language"], "name": f"{request['language']}-Chirp3-HD-{request['voice']}"}
    if request["model"] == "chirp-3-instant-custom-voice":
        return {"language_code": request["language"], "voice_clone": {"voice_cloning_key": request["voice"]}}
    speakers = request.get("speakers")
    if speakers is not None:
        return {"language_code": request["language"], "model_name": request["model"], "multi_speaker_voice_config": {
            "speaker_voice_configs": [{"speaker_alias": speaker["alias"], "speaker_id": speaker["voice"]} for speaker in speakers],
        }}
    voice = request.get("voice")
    assert voice is not None
    return {"language_code": request["language"], "model_name": request["model"], "name": voice}


def _config(request: TtsRequest) -> proto.StreamingSynthesizeConfig:
    output = request["output"]
    encodings: dict[str, proto.AudioEncoding] = {"pcm": "PCM", "ogg_opus": "OGG_OPUS", "mp3": "MP3", "wav": "LINEAR16", "alaw": "ALAW", "mulaw": "MULAW"}
    encoding = encodings[output["format"]]
    if output["format"] == "wav" and output.get("sample_encoding") in ("alaw", "mulaw"):
        encoding = encodings[str(output.get("sample_encoding"))]
    rate = output.get("sample_rate_hz")
    replacements = request.get("replacements")
    safety = request.get("safety_settings")
    advanced: proto.AdvancedVoiceOptions = {"enable_textnorm": request.get("text_normalization", True)}
    if safety is not None:
        advanced = {**advanced, "safety_settings": {"settings": [{"category": _CATEGORIES[item["category"]], "threshold": _THRESHOLDS[item["threshold"]]} for item in safety]}}
    audio: proto.StreamingAudioConfig = {"audio_encoding": encoding, "speaking_rate": request.get("speed", REQUEST_DEFAULTS["speed"])}
    if rate is not None:
        audio = {**audio, "sample_rate_hertz": int(rate)}
    config: proto.StreamingSynthesizeConfig = {"voice": _voice(request), "streaming_audio_config": audio}
    if replacements is not None:
        config = {**config, "custom_pronunciations": {"pronunciations": [{"phrase": item["pattern"], "pronunciation": item["replacement"], "phonetic_encoding": _PHONETICS[item["alphabet"]]} for item in replacements]}}
    if request["model"].startswith("gemini-"):
        config = {**config, "advanced_voice_options": advanced}
    return config


def _rest_request(request: TtsRequest, config: proto.StreamingSynthesizeConfig) -> rest.SynthesizeSpeechRequest:
    voice = config["voice"]
    clone, speakers, model, name = voice.get("voice_clone"), voice.get("multi_speaker_voice_config"), voice.get("model_name"), voice.get("name")
    wire_voice: rest.VoiceSelectionParams = {"languageCode": voice["language_code"]}
    if name is not None:
        wire_voice = {**wire_voice, "name": name}
    if model is not None:
        wire_voice = {**wire_voice, "modelName": model}
    if clone is not None:
        wire_voice = {**wire_voice, "voiceClone": {"voiceCloningKey": clone["voice_cloning_key"]}}
    if speakers is not None:
        wire_voice = {**wire_voice, "multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [{"speakerAlias": item["speaker_alias"], "speakerId": item["speaker_id"]} for item in speakers["speaker_voice_configs"]]}}
    audio = config.get("streaming_audio_config")
    assert audio is not None
    rate, speed = audio.get("sample_rate_hertz"), audio.get("speaking_rate")
    volume, pitch, effects = request.get("volume_db"), request.get("pitch_semitones"), request.get("effects_profiles")
    wire_audio: rest.AudioConfig = {"audioEncoding": audio["audio_encoding"]}
    if speed is not None:
        wire_audio = {**wire_audio, "speakingRate": speed}
    if rate is not None:
        wire_audio = {**wire_audio, "sampleRateHertz": rate}
    if volume is not None:
        wire_audio = {**wire_audio, "volumeGainDb": volume}
    if pitch is not None:
        wire_audio = {**wire_audio, "pitch": pitch}
    if effects is not None:
        wire_audio = {**wire_audio, "effectsProfileId": effects}
    advanced = config.get("advanced_voice_options")
    safety = advanced.get("safety_settings") if advanced is not None else None
    wire_advanced: rest.AdvancedVoiceOptions = {}
    if advanced is not None and "enable_textnorm" in advanced:
        wire_advanced = {**wire_advanced, "enableTextnorm": advanced["enable_textnorm"]}
    if safety is not None:
        wire_advanced = {**wire_advanced, "safetySettings": {"settings": safety.get("settings", [])}}
    pronunciation = config.get("custom_pronunciations")
    replacements: list[rest.CustomPronunciationParams] = []
    if pronunciation is not None:
        for item in pronunciation.get("pronunciations", []):
            replacement: rest.CustomPronunciationParams = {}
            if "phrase" in item:
                replacement = {**replacement, "phrase": item["phrase"]}
            if "pronunciation" in item:
                replacement = {**replacement, "pronunciation": item["pronunciation"]}
            if "phonetic_encoding" in item:
                replacement = {**replacement, "phoneticEncoding": item["phonetic_encoding"]}
            replacements.append(replacement)
    prompt, turns, text = request.get("instructions"), request.get("turns"), request.get("text")
    if turns is not None:
        assert not isinstance(turns, AsyncIterable)
        content: rest.SynthesisInput = {"multiSpeakerMarkup": {"turns": turns}}
    else:
        assert isinstance(text, str)
        content = rest.SynthesisInput(ssml=text) if request.get("input_type") == "ssml" else rest.SynthesisInput(markup=text) if request.get("input_type") == "markup" else rest.SynthesisInput(text=text)
    if prompt is not None:
        content = {**content, "prompt": prompt}
    if pronunciation is not None:
        content = {**content, "customPronunciations": {"pronunciations": replacements}}
    result: rest.SynthesizeSpeechRequest = {"voice": wire_voice, "audioConfig": wire_audio, "input": content}
    if advanced is not None:
        result = {**result, "advancedVoiceOptions": wire_advanced}
    return result


# Retain cleanup tasks until completion, without making socket release or a
# canceled call depend on an uncooperative producer's pending __anext__/aclose.
_cleanup_tasks: set[asyncio.Task[None]] = set()


def _observe_cleanup(task: asyncio.Task[None]) -> None:
    _cleanup_tasks.discard(task)
    if not task.cancelled():
        task.exception()


async def _cleanup_input(producer: asyncio.Task[None], source: AsyncIterator[str | Turn] | None, reading: asyncio.Task[bytes]) -> None:
    try:
        await producer
    except BaseException:
        pass
    try:
        if isinstance(source, _Closable):
            await source.aclose()
    finally:
        await asyncio.gather(reading, return_exceptions=True)


async def _live(value: str | Sequence[Turn] | AsyncIterable[str | Turn], config: proto.StreamingSynthesizeConfig,
                connection: GrpcLike, clone: bool, prompt: str | None, markup: bool,
                aliases: set[str], limit: int, validate: InputValidator, field: str, message_limit: int) -> AsyncGenerator[bytes]:
    codec = proto_beta if clone else proto
    source = aiter(value) if isinstance(value, AsyncIterable) else None
    ended = False

    async def produce() -> None:
        nonlocal ended
        opening = codec.encode_streaming_request({"streaming_config": config})
        if len(opening) > message_limit:
            raise TypeError("Google gRPC message exceeds max_message_bytes")
        await connection.send(opening)
        first = True
        async def send(item: str | Sequence[Turn]) -> None:
            nonlocal first
            instruction = prompt if first else None
            if isinstance(item, str):
                _check_text(item, limit)
                if markup:
                    wire: proto.StreamingSynthesisInput = {"markup": item, "prompt": instruction} if instruction is not None else {"markup": item}
                else:
                    wire = {"text": item, "prompt": instruction} if instruction is not None else {"text": item}
            else:
                _check_turns(item, aliases, limit)
                wire = {"multi_speaker_markup": {"turns": item}, "prompt": instruction} if instruction is not None else {"multi_speaker_markup": {"turns": item}}
            # A prompt is a session instruction, not repeated with every chunk.
            message = codec.encode_streaming_request({"input": wire})
            if len(message) > message_limit:
                raise TypeError("Google gRPC message exceeds max_message_bytes")
            await connection.send(message)
            first = False
        if source is not None:
            while True:
                try:
                    item = await anext(source)
                except StopAsyncIteration:
                    break
                validate(item, field)
                await send(item if isinstance(item, str) else [item])
                await asyncio.sleep(0)
        else:
            assert not isinstance(value, AsyncIterable)
            await send(value)
        ended = True
        await connection.end()

    producer = asyncio.create_task(produce())
    reading = asyncio.create_task(connection.receive())
    produced = False
    try:
        while True:
            completed, _ = await asyncio.wait([reading] if produced else [reading, producer], return_when=asyncio.FIRST_COMPLETED)
            if not produced and producer in completed:
                producer.result()
                produced = True
            if reading in completed:
                try:
                    data = reading.result()
                except StopAsyncIteration:
                    if not ended:
                        raise TypeError("Google completed before the input stream ended") from None
                    return
                if len(data) > message_limit:
                    raise TypeError("Google gRPC message exceeds max_message_bytes")
                audio = codec.decode_streaming_response(data).get("audio_content")
                if audio:
                    yield audio
                reading = asyncio.create_task(connection.receive())
            await asyncio.sleep(0)
    finally:
        original = sys.exception()
        try:
            await connection.aclose()
        except BaseException:
            if original is None:
                raise
        finally:
            producer.cancel()
            reading.cancel()
            cleanup = asyncio.create_task(_cleanup_input(producer, source, reading))
            _cleanup_tasks.add(cleanup)
            cleanup.add_done_callback(_observe_cleanup)
            await asyncio.sleep(0)


async def _http(response: HttpResponse, body: AudioStream, limit: int) -> AsyncGenerator[bytes]:
    data = bytearray()
    async for chunk in body:
        if len(chunk) > limit - len(data):
            raise TypeError("Google response exceeds max_json_bytes")
        data.extend(chunk)
        await asyncio.sleep(0)
    if not 200 <= response.status < 300:
        message = data.decode("utf-8-sig", "replace")
        try:
            value: object = json.loads(data)
            if is_mapping(value) and is_mapping(error := value.get("error")) and isinstance(detail := error.get("message"), str):
                message = detail
        except (ValueError, RecursionError):
            pass
        raise GoogleError(response.status, message)
    try:
        packet = rest.decode_synthesize_speech_response(bytes(data))
        encoded = packet.get("audioContent")
        if encoded is None:
            raise TypeError("Google returned an invalid synthesis response")
        audio = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError, RecursionError):
        raise TypeError("Google returned an invalid synthesis response") from None
    yield audio


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     grpc: GrpcLike | None = None, base_url: str = rest.DEFAULT_BASE_URL,
                     grpc_url: str = "https://texttospeech.googleapis.com", timeout_ms: int | None = None,
                     max_json_bytes: int = 16 * 1024 * 1024, max_message_bytes: int = 64 * 1024 * 1024) -> AsyncIterator[AsyncIterator[bytes]]:
    """One synthesize operation; use async with for idle and unread resource ownership.

    Streaming formats open native authenticated HTTP/2 unless grpc is provided
    as an already authenticated override. REST requires an async HTTP transport.
    Deadlines include opening, input, output and time spent idle in the context.
    """
    validate = validate_request(request)
    for name, limit in (("max_json_bytes", max_json_bytes), ("max_message_bytes", max_message_bytes)):
        if type(limit) is not int or not 0 < limit <= 0xFFFFFFFF:
            raise TypeError(f"Google {name} must be a positive uint32 integer")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Google timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("Google synthesis deadline expired")
    limit = 4000 if request["model"].startswith("gemini-") else 5000
    speakers = request.get("speakers")
    aliases: set[str] = {speaker["alias"] for speaker in speakers} if speakers is not None else set()
    if speakers is not None and len(aliases) != len(speakers):
        raise TypeError("Google dialogue requires exactly two distinct speaker aliases")
    safety = request.get("safety_settings")
    if safety is not None and len({item["category"] for item in safety}) != len(safety):
        raise TypeError("Google safety categories must be unique")
    prompt, turns, text = request.get("instructions"), request.get("turns"), request.get("text")
    if prompt is not None:
        _check_text(prompt, 4000)
    if isinstance(text, str):
        _check_text(text, limit)
    if turns is not None and not isinstance(turns, AsyncIterable):
        _check_turns(turns, aliases, limit)
    entry: AuthGoogle = auth.get("google", {}) if auth is not None else {}
    key = entry.get("api_key", os.environ.get("SPEECHSWITCH_GOOGLE_API_KEY", os.environ.get("GOOGLE_API_KEY")))
    token = entry.get("access_token", os.environ.get("SPEECHSWITCH_GOOGLE_ACCESS_TOKEN", os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN")))
    quota = entry.get("quota_project", os.environ.get("SPEECHSWITCH_GOOGLE_QUOTA_PROJECT", os.environ.get("GOOGLE_CLOUD_QUOTA_PROJECT")))
    if not key and not token:
        raise TypeError("Missing auth.google.apiKey or auth.google.accessToken configuration")
    headers = {**({"x-goog-api-key": key} if key else {}), **({"authorization": f"Bearer {token}"} if token else {}), **({"x-goog-user-project": quota} if quota else {})}
    http = request["output"]["format"] in ("wav", "mp3") or request.get("input_type") == "ssml" or any(name in request for name in ("volume_db", "pitch_semitones", "effects_profiles"))
    raw_url = base_url if http else grpc_url
    try:
        target = urlsplit(raw_url)
        if target.scheme not in ("http", "https") or not target.hostname or target.username is not None or target.password is not None or target.fragment or any(c.isspace() or ord(c) < 32 or c == "\\" for c in raw_url):
            raise ValueError()
        _ = target.port
    except ValueError:
        raise TypeError("Invalid Google endpoint URL") from None
    config = _config(request)
    clone = request["model"] == "chirp-3-instant-custom-voice"
    codec = proto_beta if clone else proto
    url = urlunsplit((target.scheme, target.netloc, target.path.removesuffix("/") + codec.STREAMING_SYNTHESIZE_PATH, target.query, ""))
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if http:
                if transport is None:
                    raise TypeError("Google HTTP transport is required")
                wire = _rest_request(request, config)
                if clone:
                    # Beta's additional optional fields prevent structural
                    # assignment from an open stable TypedDict; narrow using
                    # the generated beta contract instead of an unchecked cast.
                    assert rest_beta.is_synthesize_speech_request(wire)
                    response = await rest_beta.synthesize_speech(wire, base_url=base_url, headers=headers, transport=transport)
                else:
                    response = await rest.synthesize_speech(wire, base_url=base_url, headers=headers, transport=transport)
                async with _closing(AudioStream(response.body)) as body:
                    async with _closing(_http(response, body, max_json_bytes)) as audio:
                        yield audio
            else:
                value = turns if turns is not None else text
                assert value is not None
                if grpc is not None:
                    async with _closing(grpc):
                        async with _closing(_live(value, config, grpc, clone, prompt, request.get("input_type") == "markup", aliases, limit, validate, "turns" if turns is not None else "text", max_message_bytes)) as audio:
                            yield audio
                else:
                    async with connect_grpc(url, headers=headers, max_message_bytes=max_message_bytes) as connection:
                        async with _closing(_live(value, config, connection, clone, prompt, request.get("input_type") == "markup", aliases, limit, validate, "turns" if turns is not None else "text", max_message_bytes)) as audio:
                            yield audio
    except TimeoutError:
        if deadline.expired():
            raise TimeoutError("Google synthesis deadline expired") from None
        raise
