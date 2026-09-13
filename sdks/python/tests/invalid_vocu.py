from speechswitch.generated.vocu import TtsRequest
request: TtsRequest = {"text": "Hello", "voice": "owned", "input_type": "markup", "subtitle_format": "srt"}
from speechswitch.generated.vocu_output import SynthesisItem
from speechswitch.http import HttpTransport
from speechswitch.providers.vocu import synthesize
clear: SynthesisItem = {"event": "clear"}
model: TtsRequest = {"text": "Hi", "voice": "owned", "model": "v3.5"}
reference: TtsRequest = {"text": "Hi", "voice": "owned", "reference_emphasis": "expressive"}
splitter: TtsRequest = {"text": "Hi", "voice": "owned", "text_splitter": {"id": "saved"}}
async def invalid_input(transport: HttpTransport) -> None:
    async def text():
        yield "Hi"
    async with synthesize({"voice": "owned", "text": text()}, transport=transport):
        pass
