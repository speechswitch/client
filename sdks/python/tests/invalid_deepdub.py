from speechswitch.generated.deepdub import TtsRequest

seed: TtsRequest = {"model": "phantom-x-3.2", "voice": "custom", "text": "Hello", "language": "en-US", "output": {"format": "mp3"}, "random_seed": 42}
duration: TtsRequest = {"model": "og-1.1", "voice": "custom", "text": "Hello", "language": "en-US", "output": {"format": "mp3"}, "speed": 1, "target_duration_ms": 1000}
rate: TtsRequest = {"model": "og-1.1", "voice": "custom", "text": "Hello", "language": "en-US", "output": {"format": "mp3", "sample_rate_hz": 12000}}
voice: TtsRequest = {"model": "og-1.1", "text": "Hello", "language": "en-US", "output": {"format": "mp3"}}
