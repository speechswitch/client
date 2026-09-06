from collections.abc import AsyncIterator
import unittest
from speechswitch.generated.stream import AudioStream, AudioStreamItem, TimestampStreamItem


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_output_stream_preserves_independent_timing_and_control_events(self) -> None:
        timeline: TimestampStreamItem = {
            "correlation": "timeline", "correlation_id": "native-group", "input_group_id": "input",
            "timeline_offset_ms": 0, "timestamp_update": "replace",
            "timestamps": [{"kind": "word", "value": "Hello", "start_time_ms": 0, "end_time_ms": 12}],
        }

        async def messages() -> AsyncIterator[AudioStreamItem]:
            yield timeline
            yield bytes([0, 255, 128])
            yield {"correlation": "chunk", "audio": bytes([1, 2]), "duration_ms": 0, "timestamps": []}
            yield {"event": "updated", "replacements": [], "temperature": 0, "text_normalization": False}
            yield {"event": "clear"}
            yield {"event": "flush", "correlation_id": "native-group", "input_group_id": "input"}
            yield {"event": "done"}

        stream: AudioStream = messages()
        self.assertEqual([item async for item in stream], [
            {"correlation": "timeline", "correlation_id": "native-group", "input_group_id": "input",
             "timeline_offset_ms": 0, "timestamp_update": "replace",
             "timestamps": [{"kind": "word", "value": "Hello", "start_time_ms": 0, "end_time_ms": 12}]},
            bytes([0, 255, 128]),
            {"correlation": "chunk", "audio": bytes([1, 2]), "duration_ms": 0, "timestamps": []},
            {"event": "updated", "replacements": [], "temperature": 0, "text_normalization": False},
            {"event": "clear"},
            {"event": "flush", "correlation_id": "native-group", "input_group_id": "input"},
            {"event": "done"},
        ])
