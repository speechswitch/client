from speechswitch.generated.voice_ai import TtsRequest, TtsRequestObject1ec54d36TextAsyncIterableItem as TtsInput
request: TtsRequest = {"text": "Hello", "model": "voiceai-tts-lite-v1-latest", "language": "es"}
from speechswitch.generated.voice_ai_output import SynthesisItem, VoiceAiEnvelope
from speechswitch.providers.voice_ai import synthesize
from speechswitch.http import HttpTransport
from collections.abc import AsyncIterable
paced: TtsRequest = {"text": "Hello", "audio_delivery": "paced", "output": {"format": "mp3"}}
dictionary: TtsRequest = {"text": "Hello", "pronunciation_dictionaries": [{"id": "dictionary", "version_id": "2"}]}
update: TtsInput = {"command": "update"}
event: SynthesisItem = {"event": "updated"}
timing: VoiceAiEnvelope = {"correlation": "ordered", "correlation_id": "context", "audio": b"x", "timestamps": [{"kind": "word", "value": "Hello"}]}
async def legacy(text: AsyncIterable[str], backend: HttpTransport) -> None:
    async with synthesize({"api_version": "tts-v2", "voice": "owned", "text": text}, transport=backend): pass
async def wrong(backend: HttpTransport) -> None:
    async with synthesize({"event": "done"}, transport=backend): pass
