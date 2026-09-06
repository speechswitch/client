from collections.abc import AsyncIterator
from speechswitch.generated.elevenlabs import TtsRequest, TtsRequestStreamingTextVoice194990a6TextItem as Input
from speechswitch.generated.elevenlabs_output import TimestampedAudio
async def text() -> AsyncIterator[Input]: yield "hello"
v3_controls: TtsRequest = {"model":"eleven-v3","voice":"v","text":"hello","output":{"format":"mp3"},"speed":1}
v3_clear: TtsRequest = {"model":"eleven-v3","voice":"v","text":text(),"output":{"format":"mp3"}}
buffering: TtsRequest = {"model":"flash-v2.5","voice":"v","text":text(),"output":{"format":"mp3"},"text_buffering":False,"text_buffer_thresholds":[50]}
stream_wav: TtsRequest = {"model":"flash-v2.5","voice":"v","text":text(),"output":{"format":"wav","sample_rate_hz":16000}}
dictionary: TtsRequest = {"model":"flash-v2.5","voice":"v","text":text(),"output":{"format":"mp3"},"pronunciation_dictionaries":[{"id":"lex"}]}
correlation: TimestampedAudio = {"correlation":"timeline","audio":b"","timestamps":[]}
