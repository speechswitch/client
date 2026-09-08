from collections.abc import AsyncIterable
from speechswitch.generated.fish import TtsRequest, TtsRequestS1StreamingTextTextItem

voice: TtsRequest = {"model": "s1", "text": "hi", "output": {"format": "mp3"}, "speakers": [{"voice": "a"}]}
loudness: TtsRequest = {"model": "s1", "text": "hi", "voice": "a", "output": {"format": "mp3"}, "loudness_normalization": False}
bitrate: TtsRequest = {"model": "s2-pro", "text": "hi", "voice": "a", "output": {"format": "pcm", "bit_rate_bps": 128000}}
clear: TtsRequestS1StreamingTextTextItem = {"command": "clear"}
def streaming(text: AsyncIterable[str]) -> None:
    _timed: TtsRequest = {"model": "s2-pro", "text": text, "voice": "a", "output": {"format": "mp3"}, "timestamp_granularity": "segment"}
