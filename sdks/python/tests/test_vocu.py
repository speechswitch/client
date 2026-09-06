import unittest
from speechswitch.generated.vocu import TtsRequest

class VocuTypes(unittest.TestCase):
    def test_markup_preserves_voice_and_zero_seed(self) -> None:
        request: TtsRequest = {"text": "{{happy}}Hello", "voice": "market:owned", "input_type": "markup", "voice_style": "existing-style", "random_seed": 0, "vivid_expression": False}
        self.assertEqual(request, {"text": "{{happy}}Hello", "voice": "market:owned", "input_type": "markup", "voice_style": "existing-style", "random_seed": 0, "vivid_expression": False})
