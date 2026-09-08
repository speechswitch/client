from speechswitch.generated.lovo import TtsRequest
from speechswitch.generated.lovo_output import SynthesisItem

model: TtsRequest = {"text": "Hi", "voice": "v", "model": "pro"}
language: TtsRequest = {"text": "Hi", "voice": "v", "language": "en"}
output: TtsRequest = {"text": "Hi", "voice": "v", "output": {"format": "mp3"}}
voice: TtsRequest = {"text": "Hi", "voice_name": "v"}
stream: TtsRequest = {"text": iter(["Hi"]), "voice": "v"}
clear: TtsRequest = {"text": {"command": "clear"}, "voice": "v"}
marks: SynthesisItem = {"correlation": "ordered", "correlation_id": "x", "input_group_id": "x", "audio": b"a", "timestamps": (None,)}
event: SynthesisItem = {"event": "done"}
