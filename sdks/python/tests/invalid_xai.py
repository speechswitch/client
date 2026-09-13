from collections.abc import AsyncIterable
from speechswitch.generated.xai import TtsRequest, TtsRequestStreamingTextTextItem as TtsInput
from speechswitch.generated.xai_output import SynthesisItem, TimestampedAudio
from speechswitch.generated.amazon import TtsRequest as AmazonRequest
from speechswitch.providers.xai import synthesize

bitrate: TtsRequest = {"text": "Hello", "output": {"format": "pcm", "bit_rate_bps": 128000}}
latency: TtsRequest = {"text": "Hello", "latency_optimization": True}
model: TtsRequest = {"text": "Hello", "model": "other"}
update: TtsInput = {"command": "update"}
event: SynthesisItem = {"event": "updated"}
timing: TimestampedAudio = {"correlation": "timeline", "audio": b"x", "timestamps": []}
interval: TimestampedAudio = {"correlation": "chunk", "audio": b"x", "timestamps": [{"kind": "character", "value": "x", "start_time_ms": 0}]}
async def amazon(text: AsyncIterable[TtsInput]) -> None:
    _request: AmazonRequest = {"text": text, "model": "generative", "voice": "Joanna", "output": {"format": "mp3"}}
async def wrong() -> None:
    async with synthesize({"event": "done"}): pass
