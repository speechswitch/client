import unittest
from speechswitch.generated.typecast import TtsRequest

class TypecastTypes(unittest.TestCase):
    def test_smart_emotion_preserves_context_and_zero_loudness(self) -> None:
        request: TtsRequest = {"model": "ssfm-v30", "text": "Hello", "voice": "uc_voice", "emotion": "auto", "context_before": {"text": ""}, "random_seed": 0, "target_loudness_lufs": 0}
        self.assertEqual(request, {"model": "ssfm-v30", "text": "Hello", "voice": "uc_voice", "emotion": "auto", "context_before": {"text": ""}, "random_seed": 0, "target_loudness_lufs": 0})
