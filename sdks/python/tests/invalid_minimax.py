from collections.abc import AsyncIterator
from speechswitch.generated.minimax import TtsRequest, TtsRequestStreamingText12421ea0TextItem as TtsInput
from speechswitch.generated.minimax_output import SynthesisItem
async def text() -> AsyncIterator[str]: yield "Hi"
emotion: TtsRequest = {"text":"Hi", "voice":"v", "model":"speech-2.8-hd", "emotion":"whisper"}
language: TtsRequest = {"text":"Hi", "voice":"v", "model":"speech-02-hd", "language":"fa"}
formula: TtsRequest = {"text":"Hi", "voice":"v", "formula_reading":"latex", "language":"en"}
blend: TtsRequest = {"text":"Hi", "voice":"v", "voice_blend":[{"voice":"v2", "weight":50}]}
wav: TtsRequest = {"text":text(), "voice":"v", "output":{"format":"wav"}}
timestamps: TtsRequest = {"text":text(), "voice":"v", "timestamp_granularity":"word"}
split: TtsRequest = {"text":text(), "voice":"v", "model":"speech-2.6-hd", "split_turns":True}
normalize: TtsRequest = {"text":text(), "voice":"v", "text_normalization":True}
effects: TtsRequest = {"text":text(), "voice":"v", "output":{"format":"flac"}, "voice_transform":{}}
reference: TtsRequest = {"text":"Hi", "voice":"v", "reference_audio":b"audio"}
update: TtsInput = {"command":"update", "replacements":[]}
chunk: SynthesisItem = {"correlation":"chunk", "audio":b"audio", "timestamps":[]}
flush: SynthesisItem = {"event":"flush"}
