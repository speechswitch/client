from collections.abc import AsyncIterable
from speechswitch.generated.inworld import TtsRequest, TtsRequestStreamingTextVoiceTextItem as Input
from speechswitch.generated.inworld_output import SynthesisItem

temperature: TtsRequest = {"model":"inworld-tts-2","text":"Hi","voice":"custom","output":{"format":"pcm"},"temperature":1}
delivery: TtsRequest = {"model":"inworld-tts-2-flash","text":"Hi","voice":"custom","output":{"format":"pcm"},"delivery_mode":"stable"}
instructions: TtsRequest = {"model":"inworld-tts-1.5-max","text":"Hi","voice":"custom","output":{"format":"pcm"},"instructions":"Quiet"}
rate: TtsRequest = {"model":"inworld-tts-2","text":"Hi","voice":"custom","output":{"format":"mp3","sample_rate_hz":8000}}
voice: TtsRequest = {"model":"inworld-tts-2","text":"Hi","voice_name":"Ava","output":{"format":"pcm"}}
clear: Input = {"command":"clear"}
event: SynthesisItem = {"event":"clear"}
chunk: SynthesisItem = {"correlation":"chunk","timestamps":[]}
def streaming(text: AsyncIterable[str]) -> tuple[TtsRequest, TtsRequest]:
    acting: TtsRequest = {"model":"inworld-tts-2","text":text,"voice":"custom","output":{"format":"pcm"},"instructions":"Quiet"}
    flac: TtsRequest = {"model":"inworld-tts-2","text":text,"voice":"custom","output":{"format":"flac"}}
    return acting, flac
