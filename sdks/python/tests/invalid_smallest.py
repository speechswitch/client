from speechswitch.generated.smallest_ai import TtsRequest
invalid: TtsRequest = {"model": "lightning-v3.1", "text": "Hi", "voice": "custom", "language": "ja"}
from collections.abc import AsyncIterable
from speechswitch.generated.smallest_ai import TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItem as Input
from speechswitch.generated.smallest_ai_output import SynthesisItem
def legacy_clear(text: AsyncIterable[Input]) -> None: _invalid: TtsRequest = {"model": "lightning-v3.1", "voice": "custom", "text": text}
def mixed_buffering(text: AsyncIterable[str]) -> None: _invalid: TtsRequest = {"model": "lightning-v3.1-pro", "voice": "custom", "text": text, "continuation": {"id": "ctx"}, "max_buffer_delay_ms": 10}
def socket_dictionary(text: AsyncIterable[str]) -> None: _invalid: TtsRequest = {"model": "lightning-v3.1-pro", "voice": "custom", "text": text, "pronunciation_dictionaries": []}
invalid_voice: TtsRequest = {"model": "lightning-v3.1-pro", "voice": "custom", "text": "Hello", "timestamp_granularity": "word"}
invalid_language: TtsRequest = {"model": "lightning-v3.1-pro", "voice": "meher", "text": "Hello", "timestamp_granularity": "word", "language": "ja"}
invalid_retired_model: TtsRequest = {"model": "lightning-v2", "voice": "custom", "text": "Hello"}
invalid_pcm_field: TtsRequest = {"model": "lightning-v3.1", "voice": "custom", "text": "Hello", "output": {"format": "mp3", "sample_encoding": "signed_integer_16"}}
invalid_pairing: SynthesisItem = {"correlation": "chunk", "correlation_id": "native", "audio": b"x", "timestamps": []}
