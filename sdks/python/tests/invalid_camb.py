from collections.abc import AsyncIterable
from speechswitch.generated.camb import TtsRequest

def invalid(text: AsyncIterable[str]) -> None:
    wrong_model: TtsRequest = {"model": "mars8-pro", "text": text, "voice": "42", "language": "en-us", "output": {"format": "mp3"}}
    wrong_pcm: TtsRequest = {"model": "mars8.1-flash-beta", "text": text, "voice": "42", "language": "en-us", "output": {"format": "pcm", "sample_encoding": "float_32", "byte_order": "little_endian"}}
    wrong_controls: TtsRequest = {"model": "mars8-pro", "text": "Hello", "voice": "42", "language": "en-us", "output": {"format": "mp3"}, "inference_steps": 10}
    _ = wrong_model, wrong_pcm, wrong_controls
