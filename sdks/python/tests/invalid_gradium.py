from speechswitch.generated.gradium import TtsRequest, TtsRequestTextAsyncIterableItem as Input
from speechswitch.generated.gradium_output import SynthesisItem

model: TtsRequest = {"model": "tts", "voice": "existing", "text": "Hi", "output": {"format": "pcm"}}
speed: TtsRequest = {"voice": "existing", "text": "Hi", "output": {"format": "pcm"}, "speed": 1}
rate: TtsRequest = {"voice": "existing", "text": "Hi", "output": {"format": "ogg_opus", "sample_rate_hz": 48000}}
normalization: TtsRequest = {"voice": "existing", "text": "Hi", "output": {"format": "pcm"}, "text_normalization": {"locale": "en", "rules": ["NumberEn"]}}
clear: Input = {"command": "clear"}
association: SynthesisItem = {"correlation": "chunk", "audio": b"audio", "timestamps": []}
event: SynthesisItem = {"event": "clear"}
