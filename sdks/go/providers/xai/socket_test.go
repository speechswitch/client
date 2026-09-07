package xai

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/xai"
	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestInitialMapUpdatesAndMultipleUtterances(t *testing.T) {
	p, socket := newProducer(), autoSocket()
	for _, item := range []inputItem{schema.TtsRequestStreamingTextTextItemAsString{Value: "first"}, schema.TtsRequestStreamingTextTextItemAsFlush{}, schema.TtsRequestStreamingTextTextItemAsUpdate{}, schema.TtsRequestStreamingTextTextItemAsString{Value: "second"}} {
		p.values <- sourceResult{item: item}
	}
	p.values <- sourceResult{err: io.EOF}
	r := liveRequest(p)
	r.Value.Replacements = runtime.Some([]schema.TtsRequestTextReplacementsItem{{Pattern: "Acme", Replacement: "Ack me"}})
	input, err := Synthesize(deadline(t), r, Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	got, err := collect(deadline(t), input)
	if err != nil {
		t.Fatal(err)
	}
	sent := []map[string]any{}
	for len(socket.sent) > 0 {
		sent = append(sent, <-socket.sent)
	}
	equal(t, sent, []map[string]any{{"type": "session.update", "replace": map[string]any{"Acme": "Ack me"}}, {"type": "text.delta", "delta": "first"}, {"type": "text.done"}, {"type": "session.update", "replace": map[string]any{}}, {"type": "text.delta", "delta": "second"}, {"type": "text.done"}})
	equal(t, got, []out.SynthesisItem{
		out.SynthesisItemAsUpdated{Value: out.UpdatedEvent{Replacements: []out.UpdatedEventReplacementsItem{{Pattern: "Acme", Replacement: "Ack me"}}}},
		out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}, out.SynthesisItemAsDone{Value: out.DoneEvent{TraceId: runtime.Some("native")}},
		out.SynthesisItemAsUpdated{Value: out.UpdatedEvent{Replacements: []out.UpdatedEventReplacementsItem{}}},
		out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}, out.SynthesisItemAsDone{Value: out.DoneEvent{TraceId: runtime.Some("native")}},
	})
	await(t, p.closed)
	equal(t, socket.closes.Load(), int32(1))
}

func TestClearInterruptsFlushDropsStaleAudioAndGatesText(t *testing.T) {
	for _, flushing := range []bool{false, true} {
		t.Run(map[bool]string{false: "active", true: "flushing"}[flushing], func(t *testing.T) {
			p, socket := newProducer(), newSocket()
			p.values <- sourceResult{item: schema.TtsRequestStreamingTextTextItemAsString{Value: "old"}}
			input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			result := consume(t, input)
			equal(t, socket.message(t), map[string]any{"type": "text.delta", "delta": "old"})
			if flushing {
				p.values <- sourceResult{item: schema.TtsRequestStreamingTextTextItemAsFlush{}}
				equal(t, socket.message(t), map[string]any{"type": "text.done"})
			}
			p.values <- sourceResult{item: schema.TtsRequestStreamingTextTextItemAsClear{}}
			equal(t, socket.message(t), map[string]any{"type": "text.clear"})
			p.values <- sourceResult{item: schema.TtsRequestStreamingTextTextItemAsString{Value: "new"}}
			socket.push(map[string]any{"type": "audio.delta", "delta": "AQ=="})
			socket.push(map[string]any{"type": "audio.done"})
			select {
			case m := <-socket.sent:
				t.Fatalf("text sent before clear ACK: %#v", m)
			case <-time.After(10 * time.Millisecond):
			}
			socket.push(map[string]any{"type": "audio.clear"})
			equal(t, socket.message(t), map[string]any{"type": "text.delta", "delta": "new"})
			p.values <- sourceResult{err: io.EOF}
			equal(t, socket.message(t), map[string]any{"type": "text.done"})
			socket.push(map[string]any{"type": "audio.delta", "delta": "Ag=="})
			socket.push(map[string]any{"type": "audio.done"})
			got := <-result
			if got.err != nil {
				t.Fatal(got.err)
			}
			equal(t, got.items, []out.SynthesisItem{out.SynthesisItemAsClear{}, out.SynthesisItemAsBytes{Value: []byte{2}}, out.SynthesisItemAsDone{}})
			equal(t, socket.closes.Load(), int32(1))
		})
	}
}

func TestUpdateUsesServerEchoAndEOFAwaitsAcknowledgement(t *testing.T) {
	p, socket := newProducer(), newSocket()
	p.values <- sourceResult{item: schema.TtsRequestStreamingTextTextItemAsUpdate{Value: schema.TtsRequestStreamingTextTextItemUpdate{Replacements: []schema.TtsRequestTextReplacementsItem{{Pattern: "Acme", Replacement: "local"}}}}}
	p.values <- sourceResult{err: io.EOF}
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	result := consume(t, input)
	equal(t, socket.message(t), map[string]any{"type": "session.update", "replace": map[string]any{"Acme": "local"}})
	select {
	case got := <-result:
		t.Fatalf("finished before ACK: %#v", got)
	case <-time.After(10 * time.Millisecond):
	}
	socket.received <- frameResult{frame: runtime.WebSocketText(`{"type":"session.updated","replace":{"Zulu":"z","Acme":"native"}}`)}
	got := <-result
	if got.err != nil {
		t.Fatal(got.err)
	}
	equal(t, got.items, []out.SynthesisItem{out.SynthesisItemAsUpdated{Value: out.UpdatedEvent{Replacements: []out.UpdatedEventReplacementsItem{{Pattern: "Zulu", Replacement: "z"}, {Pattern: "Acme", Replacement: "native"}}}}})
}

func TestSharedInvalidFramesAndUnsolicitedEvents(t *testing.T) {
	cases := loadFixture(t).InvalidFrames
	for _, extra := range []struct{ Wire, Error string }{
		{`{`, "Invalid xAI JSON"}, {`{"x":NaN}`, "Invalid xAI JSON"}, {`{"x":"\ud800"}`, "Invalid xAI JSON"},
		{`{"type":"audio.clear"}`, "Unexpected xAI audio.clear acknowledgement"}, {`{"type":"audio.done"}`, "Unexpected xAI audio.done acknowledgement"},
		{`{"type":"session.updated","replace":{}}`, "Unexpected xAI session.updated acknowledgement"}, {`{"type":"audio.delta","delta":"AQ=="}`, "xAI audio arrived outside an active utterance"},
		{`{"type":"error","message":"private"}`, "xAI reported a synthesis error"},
	} {
		cases = append(cases, extra)
	}
	for _, c := range cases {
		t.Run(c.Wire, func(t *testing.T) {
			p, socket := newProducer(), newSocket()
			socket.received <- frameResult{frame: runtime.WebSocketText(c.Wire)}
			input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			got, err := input.Next(deadline(t))
			equal(t, got, nil)
			if err == nil {
				t.Fatal("accepted invalid frame")
			}
			equal(t, err.Error(), c.Error)
			_, err = input.Next(deadline(t))
			equal(t, err, io.EOF)
			equal(t, socket.closes.Load(), int32(1))
		})
	}
	for _, c := range []struct {
		frame runtime.WebSocketMessage
		err   error
		want  string
	}{
		{frame: runtime.WebSocketBinary("binary"), want: "xAI returned a non-text WebSocket message"},
		{err: io.EOF, want: "xAI WebSocket closed before pending synthesis or acknowledgements completed"},
	} {
		p, socket := newProducer(), newSocket()
		socket.received <- frameResult{frame: c.frame, err: c.err}
		input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		defer input.Close()
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted invalid frame")
		}
		equal(t, err.Error(), c.want)
	}
}

func TestPendingFlushWriteAllowsAudioButCannotHideWriteFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "failure"}[fail], func(t *testing.T) {
			release := make(chan struct{})
			failure := errors.New("send failed")
			p, socket := newProducer(), newSocket()
			socket.write = func(ctx context.Context, m map[string]any) error {
				if m["type"] == "text.done" {
					socket.push(map[string]any{"type": "audio.delta", "delta": "AQ=="})
					socket.push(map[string]any{"type": "audio.done"})
					select {
					case <-release:
					case <-ctx.Done():
						return ctx.Err()
					}
					if fail {
						return failure
					}
				}
				return nil
			}
			p.values <- sourceResult{item: schema.TtsRequestStreamingTextTextItemAsString{Value: "hello"}}
			p.values <- sourceResult{err: io.EOF}
			input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			item, err := input.Next(deadline(t))
			if err != nil {
				t.Fatal(err)
			}
			equal(t, item, out.SynthesisItemAsBytes{Value: []byte{1}})
			result := consume(t, input)
			select {
			case got := <-result:
				t.Fatalf("completed before write: %#v", got)
			case <-time.After(10 * time.Millisecond):
			}
			close(release)
			got := <-result
			if fail {
				equal(t, got.err, failure)
				equal(t, len(got.items), 0)
			} else {
				equal(t, got.err, nil)
				equal(t, got.items, []out.SynthesisItem{out.SynthesisItemAsDone{}})
			}
		})
	}
}

func TestGeneratedInputValidationAndNativePerDeltaLimit(t *testing.T) {
	for _, c := range []struct {
		item inputItem
		want string
	}{
		{nil, "Invalid xai TTS input item"},
		{(*schema.TtsRequestStreamingTextTextItemAsString)(nil), "Invalid xai TTS input item"},
		{schema.TtsRequestStreamingTextTextItemAsString{Value: strings.Repeat("😀", 15001)}, "xAI text.delta exceeds 15000 characters"},
		{schema.TtsRequestStreamingTextTextItemAsUpdate{Value: schema.TtsRequestStreamingTextTextItemUpdate{Replacements: []schema.TtsRequestTextReplacementsItem{{Pattern: strings.Repeat("x", 101), Replacement: "a"}}}}, "Invalid xai TTS input item"},
		{schema.TtsRequestStreamingTextTextItemAsUpdate{Value: schema.TtsRequestStreamingTextTextItemUpdate{Replacements: []schema.TtsRequestTextReplacementsItem{{Pattern: " Acme\u00a0Mobile ", Replacement: "a"}, {Pattern: "acme mobile", Replacement: "b"}}}}, "Duplicate xAI replacement phrase: acme mobile"},
	} {
		p, socket := newProducer(), newSocket()
		p.values <- sourceResult{item: c.item}
		input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		defer input.Close()
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted invalid input")
		}
		equal(t, err.Error(), c.want)
		equal(t, socket.sends.Load(), int32(0))
		await(t, p.closed)
	}
}

func TestEmptyFlushClearOnlyAndEmptyTimestampArrays(t *testing.T) {
	for _, c := range []struct {
		inputs []inputItem
		want   []out.SynthesisItem
	}{
		{[]inputItem{schema.TtsRequestStreamingTextTextItemAsString{}, schema.TtsRequestStreamingTextTextItemAsFlush{}}, nil},
		{[]inputItem{schema.TtsRequestStreamingTextTextItemAsClear{}}, []out.SynthesisItem{out.SynthesisItemAsClear{}}},
		{[]inputItem{&schema.TtsRequestStreamingTextTextItemAsString{Value: "hello"}}, []out.SynthesisItem{out.SynthesisItemAsChunk{Value: out.TimestampedAudio{Audio: []byte{0, 255, 128}, Timestamps: []out.CharacterTimestamp{}}}, out.SynthesisItemAsDone{Value: out.DoneEvent{TraceId: runtime.Some("native")}}}},
	} {
		p, socket := newProducer(), autoSocket()
		for _, item := range c.inputs {
			p.values <- sourceResult{item: item}
		}
		p.values <- sourceResult{err: io.EOF}
		r := liveRequest(p)
		r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextTimestampGranularity{})
		input, err := Synthesize(deadline(t), &r, Options{Auth: authenticated(), WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		defer input.Close()
		got, err := collect(deadline(t), input)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, got, c.want)
		equal(t, socket.closes.Load(), int32(1))
	}
}
