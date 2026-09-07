from collections.abc import AsyncIterable
from speechswitch.generated.respeecher import TtsRequest
def invalid(text: AsyncIterable[str]) -> None:
    wave_stream: TtsRequest = {"voice": "v", "text": text, "output": {"format": "wav"}}
    mulaw_encoding: TtsRequest = {"voice": "v", "text": "hi", "output": {"format": "mulaw", "sample_encoding": "float_32"}}
    wave_encoding: TtsRequest = {"voice": "v", "text": "hi", "output": {"format": "wav", "sample_encoding": "float_32"}}
    unknown_model: TtsRequest = {"voice": "v", "text": "hi", "model": "marketplace"}
    reference: TtsRequest = {"voice": "v", "text": "hi", "reference_audio": b"audio"}
    timestamps: TtsRequest = {"voice": "v", "text": "hi", "timestamp_granularity": "word"}
    missing_voice: TtsRequest = {"text": "hi"}
    print(wave_stream, mulaw_encoding, wave_encoding, unknown_model, reference, timestamps, missing_voice)
