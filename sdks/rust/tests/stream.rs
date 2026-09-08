use speechswitch_types::{generated::stream::*, runtime::InputStream};
use std::{collections::VecDeque, error::Error, pin::Pin, task::{Context, Poll}};

struct Messages(VecDeque<AudioStreamItem>);
impl InputStream<AudioStreamItem> for Messages {
    fn poll_next(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Result<AudioStreamItem, Box<dyn Error + Send + Sync>>>> {
        Poll::Ready(self.0.pop_front().map(Ok))
    }
}

#[test]
fn output_stream_preserves_independent_timing_and_control_events() {
    let marks = SynthesisEnvelopeOrderedOrTimeline {
        correlation: SynthesisEnvelopeOrderedOrTimelineCorrelation::Timeline(Default::default()),
        correlation_id: Some("native-group".into()), input_group_id: Some("input".into()),
        timeline_offset_ms: Some(0.0), duration_ms: None, audio: None, audio_timing: None,
        timestamp_update: Some(Default::default()), timestamp_origin: None,
        timestamps: vec![Timestamp {
            kind: TimestampKind::Word(Default::default()), value: "Hello".into(),
            start_time_ms: 0.0, end_time_ms: Some(12.0), source: Some(TimestampSource { start: 0.0, end: 5.0 }),
        }],
    };
    let mut stream: AudioStream = Box::pin(Messages(VecDeque::from([
        AudioStreamItem::OrderedOrTimeline(marks),
        AudioStreamItem::Bytes(vec![0, 255, 128]),
        AudioStreamItem::Chunk(SynthesisEnvelopeChunk {
            correlation: Default::default(), audio: vec![1, 2], duration_ms: Some(0.0), timestamps: vec![],
        }),
        AudioStreamItem::Updated(UpdatedEvent {
            event: Default::default(), replacements: Some(vec![]), temperature: Some(0.0),
            text_normalization: Some(UpdatedEventTextNormalization::False(Default::default())),
            voice_guidance: None, max_audio_tokens: None, language: None, speed: None,
        }),
        AudioStreamItem::Clear(ClearEvent { event: Default::default() }),
        AudioStreamItem::Flush(FlushEvent { event: Default::default(), correlation_id: "native-group".into(), input_group_id: Some("input".into()) }),
        AudioStreamItem::Done(DoneEvent { event: Default::default(), trace_id: None }),
    ])));
    let mut context = Context::from_waker(std::task::Waker::noop());
    let mut seen = vec![];
    while let Poll::Ready(Some(Ok(item))) = stream.as_mut().poll_next(&mut context) {
        seen.push(match item {
            AudioStreamItem::OrderedOrTimeline(value) => {
                assert_eq!(value.audio, None);
                assert_eq!(value.correlation_id.as_deref(), Some("native-group"));
                assert_eq!(value.input_group_id.as_deref(), Some("input"));
                assert_eq!(value.timeline_offset_ms, Some(0.0));
                assert_eq!(value.timestamp_update.unwrap().value(), "replace");
                assert_eq!(value.timestamps[0].start_time_ms, 0.0);
                assert_eq!(value.timestamps[0].end_time_ms, Some(12.0));
                "timeline"
            }
            AudioStreamItem::Bytes(value) => { assert_eq!(value, vec![0, 255, 128]); "bytes" }
            AudioStreamItem::Chunk(value) => { assert_eq!(value.audio, vec![1, 2]); assert_eq!(value.duration_ms, Some(0.0)); "chunk" }
            AudioStreamItem::Updated(value) => {
                assert_eq!(value.replacements.unwrap().len(), 0);
                assert_eq!(value.temperature, Some(0.0));
                assert!(matches!(value.text_normalization, Some(UpdatedEventTextNormalization::False(_))));
                "updated"
            }
            AudioStreamItem::Clear(value) => value.event.value(),
            AudioStreamItem::Flush(value) => { assert_eq!(value.correlation_id, "native-group"); value.event.value() }
            AudioStreamItem::Done(value) => { assert_eq!(value.trace_id, None); value.event.value() }
            AudioStreamItem::Batch(value) => value.event.value(),
        });
    }
    assert_eq!(seen, vec!["timeline", "bytes", "chunk", "updated", "clear", "flush", "done"]);
}
