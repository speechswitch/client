from collections.abc import AsyncIterable
from speechswitch.generated.hume import TtsRequest, TtsRequestOctave2StreamingTurnsTurnsItem as Input
from speechswitch.generated.hume_output import SynthesisItem

acting: TtsRequest = {"model":"octave-2","text":"Hi","voice":"saved","output":{"format":"pcm"},"instructions":"Whisper"}
design: TtsRequest = {"model":"octave-2","text":"Hi","voice_description":"Narrator","output":{"format":"pcm"}}
timestamps: TtsRequest = {"model":"octave-1","text":"Hi","voice":"saved","output":{"format":"pcm"},"timestamp_granularity":"word"}
rate: TtsRequest = {"model":"octave-2","text":"Hi","voice":"saved","output":{"format":"pcm","sample_rate_hz":24000}}
voice: TtsRequest = {"model":"octave-2","text":"Hi","voice":"saved","voice_name":"Ava","output":{"format":"pcm"}}
clear: Input = {"command":"clear"}
turn: Input = {"speaker":"a","text":"Hi","instructions":"Whisper"}
association: SynthesisItem = {"correlation":"chunk","audio":b"audio","timestamps":[]}
event: SynthesisItem = {"event":"flush"}
def split_stream(text: AsyncIterable[str]) -> TtsRequest:
    request: TtsRequest = {"model":"octave-2","text":text,"voice":"saved","output":{"format":"pcm"},"split_turns":False}
    return request
