import unittest
from speechswitch.generated.voice_ai import TtsRequest
from speechswitch.generated.stream import FlushEvent


class VoiceAiTests(unittest.TestCase):
    def test_existing_voice_zero_settings_and_numeric_dictionary_revision(self) -> None:
        request: TtsRequest = {"text": "Hello", "voice": "cloned", "model": "voiceai-tts-lite-v1-latest", "temperature": 0,
                               "pronunciation_dictionaries": [{"id": "owned-dictionary", "version": 2}]}
        self.assertEqual(request, {"text": "Hello", "voice": "cloned", "model": "voiceai-tts-lite-v1-latest", "temperature": 0,
                                   "pronunciation_dictionaries": [{"id": "owned-dictionary", "version": 2}]})
        flush: FlushEvent = {"event": "flush", "correlation_id": "context"}
        self.assertEqual(flush, {"event": "flush", "correlation_id": "context"})
