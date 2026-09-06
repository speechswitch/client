package runtime_test

import (
	"context"
	"io"
	"reflect"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/stream"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type outputMessages struct{ items []stream.AudioStreamItem }

func (s *outputMessages) Next(ctx context.Context) (stream.AudioStreamItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(s.items) == 0 {
		return nil, io.EOF
	}
	item := s.items[0]
	s.items = s.items[1:]
	return item, nil
}
func (s *outputMessages) Close() error { s.items = nil; return nil }

func TestOutputStreamPreservesIndependentTimingAndControlEvents(t *testing.T) {
	marks := stream.SynthesisEnvelopeOrderedOrTimeline{
		Correlation:   stream.SynthesisEnvelopeOrderedOrTimelineCorrelationAsTimeline{},
		CorrelationId: runtime.Some("native-group"), InputGroupId: runtime.Some("input"),
		TimelineOffsetMs: runtime.Some(0.0), TimestampUpdate: runtime.Some(stream.SynthesisEnvelopeOrderedOrTimelineTimestampUpdate{}),
		Timestamps: []stream.Timestamp{{Kind: stream.TimestampKindAsWord{}, Value: "Hello", StartTimeMs: 0, EndTimeMs: runtime.Some(12.0)}},
	}
	var normalization stream.UpdatedEventTextNormalization = stream.UpdatedEventTextNormalizationAsFalse{}
	updated := stream.UpdatedEvent{
		Replacements: runtime.Some([]stream.UpdatedEventReplacementsItem{}), Temperature: runtime.Some(0.0),
		TextNormalization: runtime.Some(normalization),
	}
	var events stream.AudioStream = &outputMessages{items: []stream.AudioStreamItem{
		stream.AudioStreamItemAsOrderedOrTimeline{Value: marks},
		stream.AudioStreamItemAsBytes{Value: []byte{0, 255, 128}},
		stream.AudioStreamItemAsChunk{Value: stream.SynthesisEnvelopeChunk{Audio: []byte{1, 2}, DurationMs: runtime.Some(0.0)}},
		stream.AudioStreamItemAsUpdated{Value: updated}, stream.AudioStreamItemAsClear{},
		stream.AudioStreamItemAsFlush{Value: stream.FlushEvent{CorrelationId: "native-group", InputGroupId: "input"}},
		stream.AudioStreamItemAsDone{},
	}}
	defer events.Close()
	var seen []string
	for {
		item, err := events.Next(context.Background())
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		switch value := item.(type) {
		case stream.AudioStreamItemAsOrderedOrTimeline:
			if value.Value.Audio.Present || value.Value.CorrelationId != runtime.Some("native-group") || value.Value.InputGroupId != runtime.Some("input") {
				t.Fatal("lost native correlation")
			}
			if value.Value.TimelineOffsetMs != runtime.Some(0.0) || value.Value.TimestampUpdate.Value.Value() != "replace" || !value.Value.TimestampUpdate.Present {
				t.Fatal("lost timeline update")
			}
			if !reflect.DeepEqual(value.Value.Timestamps, marks.Timestamps) {
				t.Fatal("changed timestamps")
			}
			seen = append(seen, "timeline")
		case stream.AudioStreamItemAsBytes:
			if !reflect.DeepEqual(value.Value, []byte{0, 255, 128}) {
				t.Fatal("changed audio")
			}
			seen = append(seen, "bytes")
		case stream.AudioStreamItemAsChunk:
			if !reflect.DeepEqual(value.Value.Audio, []byte{1, 2}) || value.Value.DurationMs != runtime.Some(0.0) {
				t.Fatal("lost chunk audio")
			}
			seen = append(seen, "chunk")
		case stream.AudioStreamItemAsUpdated:
			if !value.Value.Replacements.Present || len(value.Value.Replacements.Value) != 0 || value.Value.Temperature != runtime.Some(0.0) {
				t.Fatal("lost empty/zero updates")
			}
			flag, ok := value.Value.TextNormalization.Value.(stream.UpdatedEventTextNormalizationAsFalse)
			if !ok || !value.Value.TextNormalization.Present || flag.Value.Value() {
				t.Fatal("lost explicit false")
			}
			seen = append(seen, "updated")
		case stream.AudioStreamItemAsClear:
			seen = append(seen, value.Value.Event.Value())
		case stream.AudioStreamItemAsFlush:
			if value.Value.CorrelationId != "native-group" || value.Value.InputGroupId != "input" {
				t.Fatal("lost flush IDs")
			}
			seen = append(seen, value.Value.Event.Value())
		case stream.AudioStreamItemAsDone:
			if value.Value.TraceId.Present {
				t.Fatal("invented trace ID")
			}
			seen = append(seen, value.Value.Event.Value())
		default:
			t.Fatalf("unexpected output type %T", item)
		}
	}
	if !reflect.DeepEqual(seen, []string{"timeline", "bytes", "chunk", "updated", "clear", "flush", "done"}) {
		t.Fatalf("events: %v", seen)
	}
}
