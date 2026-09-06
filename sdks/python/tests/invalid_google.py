from collections.abc import AsyncIterable
from speechswitch.generated.google import TtsRequest, TtsRequestObject8dbffa0cTurnsAsyncIterableItem as Turn

instructions: TtsRequest = {"model": "chirp-3-hd", "language": "en-US", "voice": "Kore", "text": "hi", "output": {"format": "pcm"}, "instructions": "Whisper"}
clone_mp3: TtsRequest = {"model": "chirp-3-instant-custom-voice", "language": "en-US", "voice": "existing-key", "text": "hi", "output": {"format": "mp3"}}
markup: TtsRequest = {"model": "chirp-3-hd", "language": "bg-BG", "voice": "Kore", "text": "hi", "input_type": "markup", "output": {"format": "pcm"}}
lite_dialogue: TtsRequest = {"model": "gemini-2.5-flash-lite-preview-tts", "language": "en-US", "speakers": [{"alias": "A", "voice": "Kore"}, {"alias": "B", "voice": "Puck"}], "text": "hi", "output": {"format": "pcm"}}
clear: Turn = {"command": "clear"}
def streaming(text: AsyncIterable[str]) -> None:
    _wav: TtsRequest = {"model": "gemini-2.5-pro-tts", "language": "en-US", "voice": "Kore", "text": text, "output": {"format": "wav"}}
    _http_controls: TtsRequest = {"model": "gemini-2.5-pro-tts", "language": "en-US", "voice": "Kore", "text": text, "output": {"format": "pcm"}, "volume_db": 0}
