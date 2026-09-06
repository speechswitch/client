from collections.abc import AsyncIterable
from speechswitch.generated.cartesia import TtsRequest
from speechswitch.generated.cartesia_output import SynthesisItem

def invalid(text: AsyncIterable[str]) -> None:
    regional: TtsRequest = {"model": "sonic-3", "text": "Hello", "voice": "saved", "language": "en-GB", "output": {"format": "wav", "sample_rate_hz": 24000}}
    streaming: TtsRequest = {"model": "sonic-3.6", "text": text, "voice": "saved", "output": {"format": "mp3", "sample_rate_hz": 44100, "bit_rate_bps": 128000}}
    timed: TtsRequest = {"model": "sonic-3.6", "text": "Hello", "voice": "saved", "timestamp_granularity": "word", "output": {"format": "wav", "sample_rate_hz": 24000}}
    output: SynthesisItem = {"correlation": "chunk", "correlation_id": "context", "timestamps": []}
    _ = regional, streaming, timed, output
