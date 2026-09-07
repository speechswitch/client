from collections.abc import AsyncIterator
from speechswitch.providers.murf import TtsInput
from speechswitch.generated.murf import TtsRequest
from speechswitch.generated.murf_output import SynthesisItem
async def text() -> AsyncIterator[str]: yield "Hi"
gen2_stream: TtsRequest = {"text": text(), "voice": "v", "model": "gen2"}
duration: TtsRequest = {"text": "Hi", "voice": "v", "target_duration_ms": 0}
variation: TtsRequest = {"text": "Hi", "voice": "v", "model": "gen2", "delivery_variance": 0.3}
timestamps: TtsRequest = {"text": "Hi", "voice": "v", "timestamp_granularity": "word"}
original: TtsRequest = {"text": "Hi", "voice": "v", "model": "gen2", "timestamp_text": "original"}
rate: TtsRequest = {"text": "Hi", "voice": "v", "model": "gen2", "output": {"format": "pcm", "sample_rate_hz": 16000}}
buffering: TtsRequest = {"text": "Hi", "voice": "v", "text_buffer_threshold": 40}
reference: TtsRequest = {"text": "Hi", "voice": "v", "reference_audio": b"audio"}
update: TtsInput = {"command": "update", "replacements": []}
chunk: SynthesisItem = {"correlation": "chunk", "timestamps": []}
updated: SynthesisItem = {"event": "updated"}
flush: SynthesisItem = {"event": "flush", "correlation_id": "native-context"}
timestamp_end: SynthesisItem = {"correlation": "timeline", "timestamps": [{"kind": "word", "value": "Hi", "start_time_ms": 0}]}
