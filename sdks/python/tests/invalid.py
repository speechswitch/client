from speechswitch.generated import amazon, hume, murf, xai
from valid import commands

wrong_model: hume.TtsRequest = {"model": "octave-2", "text": "Hi", "voice": "saved", "output": {"format": "pcm"}, "instructions": "Whisper"}
wrong_command: xai.TtsRequestStreamingTextTextItem = {"command": "cancel"}
wrong_stream: amazon.TtsRequest = {"model": "generative", "text": commands(), "voice": "Joanna", "output": {"format": "mp3"}}
wrong_null: hume.TtsRequest = {"model": "octave-2", "text": "Hi", "voice": None, "output": {"format": "pcm"}}
wrong_fraction: murf.TtsRequest = {"model": "gen2", "text": "Hi", "voice": "saved", "delivery_variance": 0.3}
