from speechswitch.generated import openai
legacy: openai.TtsRequest = {"model": "tts-1", "text": "Hello", "voice": "alloy", "instructions": "Whisper"}
legacy_usage: openai.TtsRequest = {"model": "tts-1-hd", "text": "Hello", "voice": "alloy", "include_usage": False}
legacy_custom: openai.TtsRequest = {"text": "Hello", "voice": "saved", "voice_source": "custom"}
legacy_voice: openai.TtsRequest = {"text": "Hello", "voice": "cedar"}
custom_model: openai.TtsRequest = {"model": "tts-1", "text": "Hello", "voice": "alloy", "voice_source": "custom"}
encoded_rate: openai.TtsRequest = {"text": "Hello", "voice": "alloy", "output": {"format": "mp3", "sample_rate_hz": 24000}}
pcm_rate: openai.TtsRequest = {"text": "Hello", "voice": "alloy", "output": {"format": "pcm", "sample_rate_hz": 48000}}
language: openai.TtsRequest = {"model": "gpt-4o-mini-tts", "text": "Hello", "voice": "cedar", "language": "auto"}
from speechswitch.generated.openai_output import SynthesisItem
clear: SynthesisItem = {"event": "clear"}
missing_usage: SynthesisItem = {"event": "done", "usage": {"input_tokens": 0, "output_tokens": 1}}
