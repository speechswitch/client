from collections.abc import AsyncIterator
from speechswitch.generated import amazon, base, hume, inworld, xai

async def strings() -> AsyncIterator[str]:
    yield "Hello"

async def commands() -> AsyncIterator[xai.TtsRequestStreamingTextTextItem]:
    yield "Hello"
    yield {"command": "clear"}
    yield {"command": "update", "replacements": []}

xai_request: xai.TtsRequest = {"text": commands(), "language": "auto"}
normalized: base.TtsRequest = xai_request
amazon_request: amazon.TtsRequest = {
    "model": "generative", "text": strings(), "voice": "Joanna", "output": {"format": "mp3"},
}
hume_request: hume.TtsRequest = {
    "model": "octave-2", "text": "Hello", "voice": "saved", "output": {"format": "pcm"},
    "timestamp_granularity": ["word", "phoneme"],
}
legacy: hume.TtsRequest = {
    "model": "octave-1", "text": "Hello", "voice": "saved", "output": {"format": "pcm"}, "instructions": "Whisper",
}
normalized_hume: base.TtsRequest = hume_request
normalized_amazon: base.TtsRequest = amazon_request
inworld_request: inworld.TtsRequest = {
    "model": "inworld-tts-2", "text": strings(), "voice": "saved", "output": {"format": "pcm"},
    "delivery_mode": "creative", "timestamp_delivery": "trailing", "automatic_text_flushing": True,
}
normalized_inworld: base.TtsRequest = inworld_request
