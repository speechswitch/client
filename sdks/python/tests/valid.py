from collections.abc import AsyncIterator
from speechswitch.generated import amazon, base, hume, inworld, kugelaudio, lovo, xai

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

async def kugelaudio_commands() -> AsyncIterator[kugelaudio.TtsRequestStreamingTextVoiceTextItem]:
    yield "Hello"
    yield {"command": "clear"}
    yield {"command": "update", "temperature": 0, "text_normalization": False}
    yield {"command": "flush"}

kugelaudio_request: kugelaudio.TtsRequest = {
    "text": kugelaudio_commands(), "voice": 1071, "output": {"format": "pcm", "sample_rate_hz": 44100},
    "pronunciation_dictionary_selection": {"scope": 10, "ids": []},
}
normalized_kugelaudio: base.TtsRequest = kugelaudio_request

lovo_request: lovo.TtsRequest = {"text": "Hello", "voice": "speaker", "voice_style": "saved-style", "speed": 1}
normalized_lovo: base.TtsRequest = lovo_request
