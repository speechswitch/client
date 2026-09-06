from speechswitch.generated.stream import ClearEvent, SynthesisEnvelope, TimestampStreamItem
invalid_chunk: SynthesisEnvelope = {"correlation": "chunk", "timestamps": []}
invalid_event: ClearEvent = {"event": "cancel"}
bare_audio: TimestampStreamItem = b"audio"
