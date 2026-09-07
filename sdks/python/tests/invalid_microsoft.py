from collections.abc import AsyncIterator
from speechswitch.generated.microsoft import TtsRequest
from speechswitch.generated.microsoft_output import SynthesisItem, MicrosoftTimestamp
async def text() -> AsyncIterator[str]: yield "Hi"
hd: TtsRequest = {"text":"Hi", "voice":"en-US-Ava", "model":"dragon-hd", "speed":1.2}
omni: TtsRequest = {"text":text(), "voice":"en-US-Ava", "model":"dragon-hd-omni", "top_k":20}
ssml: TtsRequest = {"text":text(), "input_type":"ssml"}
wave: TtsRequest = {"text":text(), "voice":"en-US-AvaNeural", "output":{"format":"wav", "sample_rate_hz":24000}}
timing: TtsRequest = {"text":"Hi", "voice":"en-US-Ava", "model":"dragon-hd", "timestamp_granularity":"word"}
lexicon: TtsRequest = {"text":"Hi", "voice":"v", "lexicon_url":"https://example.com/lexicon"}
languages: TtsRequest = {"text":"Hi", "voice":"v", "preferred_languages":["en-US"]}
reference: TtsRequest = {"text":"Hi", "voice":"v", "reference_audio":b"audio"}
clear: SynthesisItem = {"event":"clear"}
animation: MicrosoftTimestamp = {"kind":"viseme", "value":"2", "start_time_ms":0, "is_last_animation":"yes"}
async def commands() -> AsyncIterator[dict[str, str]]: yield {"command": "clear"}
streaming_commands: TtsRequest = {"text":commands(), "voice":"en-US-AvaNeural"}
