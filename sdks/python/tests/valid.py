from collections.abc import AsyncIterator
from speechswitch.generated import amazon, base, hume, inworld, kugelaudio, lovo, microsoft, minimax, mistral, murf, openai, xai

async def strings() -> AsyncIterator[str]:
    yield "Hello"

async def murf_commands() -> AsyncIterator[murf.TtsRequestStreamingTextVoiceTextItem]:
    yield "Hello"
    yield {"command": "update", "voice": "saved", "speed_bias": 0, "max_buffer_delay_ms": 0}
    yield {"command": "clear"}
    yield {"command": "flush"}

murf_stream: murf.TtsRequest = {"voice": "Gordon", "text": murf_commands()}
murf_gen2: murf.TtsRequest = {"model": "gen2", "voice": "Natalie", "text": "Hello", "target_duration_ms": 0, "timestamp_granularity": "word", "timestamp_text": "original", "language": "en-US"}
normalized_murf: base.TtsRequest = murf_stream
normalized_murf_gen2: base.TtsRequest = murf_gen2

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

microsoft_request: microsoft.TtsRequest = {
    "model": "dragon-hd", "voice": "en-US-Ava", "text": strings(), "temperature": 0,
}
normalized_microsoft: base.TtsRequest = microsoft_request

async def minimax_commands() -> AsyncIterator[minimax.TtsRequestStreamingText73946d93TextItem]:
    yield "Hello"
    yield {"command": "clear"}
    yield {"command": "flush"}

minimax_request: minimax.TtsRequest = {
    "model": "speech-2.8-hd", "text": minimax_commands(), "voice": "saved-clone", "split_turns": False,
}
minimax_blend: minimax.TtsRequest = {
    "text": "Hello", "voice_blend": [{"voice": "one", "weight": 75}, {"voice": "two", "weight": 100}],
    "voice_transform": {"brightness": 0}, "output": {"format": "flac"},
}
normalized_minimax: base.TtsRequest = minimax_request
normalized_minimax_blend: base.TtsRequest = minimax_blend

mistral_request: mistral.TtsRequest = {
    "text": "Hello", "voice": "saved-voice", "reference_audio": bytes([0, 255, 128]),
    "metadata": {"values": [None, False, 0, {"label": "one"}]}, "prompt_cache_key": "cache-1",
}
normalized_mistral: base.TtsRequest = mistral_request

openai_request: openai.TtsRequest = {
    "model": "gpt-4o-mini-tts", "text": "Hello", "voice": "saved-voice", "voice_source": "custom",
    "instructions": "Whisper", "include_usage": False,
}
normalized_openai: base.TtsRequest = openai_request
