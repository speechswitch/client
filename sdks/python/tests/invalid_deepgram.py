from collections.abc import AsyncIterator
from speechswitch.generated.deepgram import TtsRequest, TtsRequestAura1StreamingTextVoiceTextItem as Input
from speechswitch.generated.deepgram_output import ClearEvent
async def text() -> AsyncIterator[Input]: yield "Hello"
language: TtsRequest = {"model":"aura-1","voice":"asteria","language":"es","text":"Hello","output":{"format":"mp3"}}
format: TtsRequest = {"model":"aura-1","voice":"asteria","language":"en","text":text(),"output":{"format":"mp3"}}
tags: TtsRequest = {"model":"aura-1","voice":"asteria","language":"en","text":text(),"output":{"format":"pcm"},"tags":["tag"]}
command: Input = {"command":"unknown"}
event: ClearEvent = {"event":"clear"}
