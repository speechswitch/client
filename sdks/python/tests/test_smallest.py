import unittest
from speechswitch.generated.smallest_ai import TtsRequest

class SmallestTypes(unittest.TestCase):
    def test_pro_preserves_language_false_and_empty_dictionaries(self) -> None:
        request: TtsRequest = {"model": "lightning-v3.1-pro", "text": "こんにちは", "voice": "saved-voice", "language": "ja", "formula_reading": False, "pronunciation_dictionaries": []}
        self.assertEqual(request, {"model": "lightning-v3.1-pro", "text": "こんにちは", "voice": "saved-voice", "language": "ja", "formula_reading": False, "pronunciation_dictionaries": []})
