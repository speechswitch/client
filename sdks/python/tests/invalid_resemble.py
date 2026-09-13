from speechswitch.generated.resemble import TtsRequest
from speechswitch.generated.resemble_output import SynthesisItem
legacy_language: TtsRequest = {"text": "Hello", "language": "en"}
turbo_guidance: TtsRequest = {"text": "Hello", "model": "chatterbox-turbo", "voice_guidance": 0.5}
multilingual_sampling: TtsRequest = {"text": "Hello", "model": "chatterbox-multilingual", "top_p": 0.5}
streaming_input: TtsRequest = {"text": iter(["Hello"])}
saved_voice: TtsRequest = {"text": "Hello", "voice": "saved"}
output_rate: TtsRequest = {"text": "Hello", "output": {"format": "wav", "sample_rate_hz": 24000}}
language_auto: TtsRequest = {"text": "Hello", "model": "chatterbox-multilingual", "language": "auto"}
clear_event: SynthesisItem = {"event": "clear"}
missing_queue_id: SynthesisItem = {"event": "done"}
