from speechswitch.generated.rime import TtsRequest
def invalid() -> None:
    missing_model: TtsRequest = {"voice": "v", "text": "hi"}
    coda_markup: TtsRequest = {"model": "coda", "voice": "v", "text": "hi", "text_markup": {"pauses": True}}
    spanish_phonemes: TtsRequest = {"model": "mist-v3", "language": "es", "voice": "v", "text": "hi", "text_markup": {"phonemes": True}}
    french_timestamps: TtsRequest = {"model": "coda", "language": "fr", "voice": "v", "text": "hi", "timestamp_granularity": "word"}
    legacy_wav: TtsRequest = {"model": "mist-v2", "voice": "v", "text": "hi", "output": {"format": "wav"}}
    modern_normalization: TtsRequest = {"model": "mist-v3", "voice": "v", "text": "hi", "text_normalization": False}
    pcm_float: TtsRequest = {"model": "coda", "voice": "v", "text": "hi", "output": {"format": "pcm", "sample_encoding": "float_32"}}
    reference: TtsRequest = {"model": "coda", "voice": "v", "text": "hi", "reference_audio": b"audio"}
    print(missing_model, coda_markup, spanish_phonemes, french_timestamps, legacy_wav, modern_normalization, pcm_float, reference)
