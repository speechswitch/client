from speechswitch.generated.typecast import TtsRequest
invalid: TtsRequest = {"model": "ssfm-v21", "text": "Hello", "voice": "uc_voice", "emotion": "auto"}
smart_intensity: TtsRequest = {"model": "ssfm-v30", "text": "Hi", "voice": "tc_voice", "emotion": "auto", "emotion_intensity": 1}
legacy_language: TtsRequest = {"model": "ssfm-v21", "text": "Hi", "voice": "tc_voice", "language": "hi"}
conflicting_gain: TtsRequest = {"model": "ssfm-v30", "text": "Hi", "voice": "tc_voice", "volume_scale": 1, "target_loudness_lufs": -20}
timed_stream_rate: TtsRequest = {"model": "ssfm-v30", "text": "Hi", "voice": "tc_voice", "timestamp_granularity": "word", "output": {"format": "wav", "sample_rate_hz": 32000}}
composed_text: TtsRequest = {"segments": [{"kind": "pause", "pause_ms": 100}], "text": "Hi"}
pause_voice: TtsRequest = {"segments": [{"kind": "pause", "pause_ms": 100, "voice": "tc_voice"}]}
reference_audio: TtsRequest = {"model": "ssfm-v30", "text": "Hi", "voice": "tc_voice", "reference_audio": b"audio"}
from speechswitch.generated.typecast_output import SynthesisItem
no_clear: SynthesisItem = {"event": "clear"}
missing_audio: SynthesisItem = {"correlation": "chunk", "duration_ms": 1, "timestamps": []}
from collections.abc import AsyncIterator
async def text() -> AsyncIterator[str]:
    yield "Hi"
streaming_input: TtsRequest = {"model": "ssfm-v30", "text": text(), "voice": "tc_voice"}
