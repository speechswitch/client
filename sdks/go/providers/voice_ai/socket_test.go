package voice_ai

import (
	"context"
	"errors"
	"io"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/voice_ai"
	out "github.com/speechswitch/client/sdks/go/generated/voice_ai_output"
)

func TestConcurrentContextsKeepNativeIdentity(t *testing.T) {
	s, p := newSocket(), newProducer()
	for _, item := range []inputItem{schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString{Value: "first"}, &schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsFlush{}, &schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString{Value: "second"}, schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsFlush{}} {
		p.values <- sourceResult{item: item}
	}
	p.values <- sourceResult{err: io.EOF}
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: s})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	ch := consume(t, input)
	first := s.message(t)["context_id"].(string)
	equal(t, s.message(t), map[string]any{"context_id": first, "text": "", "flush": true, "auto_close": true})
	second := s.message(t)["context_id"].(string)
	equal(t, s.message(t), map[string]any{"context_id": second, "text": "", "flush": true, "auto_close": true})
	if first == second {
		t.Fatal("reused context")
	}
	s.push(map[string]any{"context_id": second, "audio": "Ag=="})
	s.push(map[string]any{"context_id": first, "audio": "AQ=="})
	s.push(map[string]any{"context_id": second, "is_last": true})
	s.push(map[string]any{"context_id": second, "context_closed": true})
	s.push(map[string]any{"context_id": first, "is_last": true})
	s.push(map[string]any{"context_id": first, "context_closed": true})
	got := <-ch
	if got.err != nil {
		t.Fatal(got.err)
	}
	equal(t, got.items, []out.SynthesisItem{
		out.SynthesisItemAsOrdered{Value: out.VoiceAiEnvelope{Audio: []byte{2}, CorrelationId: second}}, out.SynthesisItemAsOrdered{Value: out.VoiceAiEnvelope{Audio: []byte{1}, CorrelationId: first}},
		out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: second}}, out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: first}}, out.SynthesisItemAsDone{},
	})
	await(t, p.closed)
	equal(t, p.closes.Load(), int32(1))
	equal(t, s.closes.Load(), int32(1))
}

func TestClearWaitsForClosureAndSuppressesRetiredAudio(t *testing.T) {
	for _, flushing := range []bool{false, true} {
		t.Run(map[bool]string{false: "buffered", true: "flushing"}[flushing], func(t *testing.T) {
			s, p := newSocket(), newProducer()
			p.values <- sourceResult{item: schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString{Value: "old"}}
			if flushing {
				p.values <- sourceResult{item: schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsFlush{}}
			}
			p.values <- sourceResult{item: &schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsClear{}}
			p.values <- sourceResult{item: schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsClear{}}
			p.values <- sourceResult{item: schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString{Value: "new"}}
			p.values <- sourceResult{err: io.EOF}
			input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: s})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			ch := consume(t, input)
			old := s.message(t)["context_id"].(string)
			if flushing {
				equal(t, s.message(t), map[string]any{"context_id": old, "text": "", "flush": true, "auto_close": true})
			} else {
				equal(t, s.message(t), map[string]any{"context_id": old, "close_context": true})
			}
			fresh := s.message(t)
			equal(t, fresh["text"], "new")
			id := fresh["context_id"].(string)
			equal(t, s.message(t), map[string]any{"context_id": id, "text": "", "flush": true, "auto_close": true})
			select {
			case result := <-ch:
				t.Fatalf("completed before closure: %#v", result)
			default:
			}
			s.push(map[string]any{"context_id": old, "audio": "AA=="})
			s.push(map[string]any{"context_id": old, "context_closed": true})
			// The context has been removed by the time the next receive starts. Its
			// canonical retired ID remains harmless without keeping an ID set forever.
			s.push(map[string]any{"context_id": old, "audio": "AQ=="})
			s.push(map[string]any{"context_id": old, "is_last": true})
			s.push(map[string]any{"context_id": old, "context_closed": true})
			finishContext(s, id)
			got := <-ch
			if got.err != nil {
				t.Fatal(got.err)
			}
			equal(t, got.items, []out.SynthesisItem{out.SynthesisItemAsClear{}, out.SynthesisItemAsClear{}, out.SynthesisItemAsOrdered{Value: out.VoiceAiEnvelope{Audio: []byte{0, 255, 128}, CorrelationId: id}}, out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: id}}, out.SynthesisItemAsDone{}})
			equal(t, s.sends.Load(), int32(4))
		})
	}
}

func TestEmptyInputFlushAndClearAreLocal(t *testing.T) {
	s, p := newSocket(), newProducer()
	for _, item := range []inputItem{schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString{}, schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsFlush{}, schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsClear{}, schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsFlush{}} {
		p.values <- sourceResult{item: item}
	}
	p.values <- sourceResult{err: io.EOF}
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: s})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	items, err := collect(deadline(t), input)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, items, []out.SynthesisItem{out.SynthesisItemAsClear{}, out.SynthesisItemAsDone{}})
	equal(t, s.sends.Load(), int32(0))
}

func TestProtocolStateRejectsPrematureAndDuplicateEvents(t *testing.T) {
	for _, c := range []struct {
		name   string
		flush  bool
		frames []map[string]any
		want   string
	}{
		{"audio before flush", false, []map[string]any{{"audio": "AA=="}}, "Voice.ai audio arrived outside an active flush"},
		{"completion before flush", false, []map[string]any{{"is_last": true}}, "Voice.ai returned an unexpected or empty flush completion"},
		{"closure before completion", true, []map[string]any{{"context_closed": true}}, "Voice.ai context closed before flush completion"},
		{"empty completion", true, []map[string]any{{"audio": ""}, {"is_last": true}}, "Voice.ai returned an unexpected or empty flush completion"},
		{"duplicate completion", true, []map[string]any{{"audio": "AA=="}, {"is_last": true}, {"is_last": true}}, "Voice.ai returned an unexpected or empty flush completion"},
		{"audio after completion", true, []map[string]any{{"audio": "AA=="}, {"is_last": true}, {"audio": "AQ=="}}, "Voice.ai audio arrived outside an active flush"},
		{"unknown context", false, []map[string]any{{"audio": "AA==", "context_id": "alien"}}, "Voice.ai returned an unknown or completed context"},
		{"reused completed context", true, []map[string]any{{"audio": "AA=="}, {"is_last": true}, {"context_closed": true}, {"audio": "AQ=="}}, "Voice.ai returned an unknown or completed context"},
	} {
		t.Run(c.name, func(t *testing.T) {
			s, p := newSocket(), newProducer()
			p.values <- sourceResult{item: schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString{Value: "Hello"}}
			if c.flush {
				p.values <- sourceResult{item: schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsFlush{}}
			}
			input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: s})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			ch := consume(t, input)
			id := s.message(t)["context_id"].(string)
			if c.flush {
				s.message(t)
			}
			for _, frame := range c.frames {
				if _, ok := frame["context_id"]; !ok {
					frame["context_id"] = id
				}
				s.push(frame)
			}
			got := <-ch
			if got.err == nil {
				t.Fatal("accepted invalid sequence")
			}
			equal(t, got.err.Error(), c.want)
			equal(t, s.closes.Load(), int32(1))
		})
	}
}

func TestReadsProgressDuringWriteAndDoneCannotHideWriteFailure(t *testing.T) {
	s := newSocket()
	release := make(chan struct{})
	failure := errors.New("write failed")
	s.write = func(ctx context.Context, m map[string]any) error {
		if m["flush"] == true {
			select {
			case <-release:
				return failure
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), WebSocket: s})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	firstRead := make(chan result, 1)
	go func() { item, err := input.Next(deadline(t)); firstRead <- result{item, err} }()
	id := s.message(t)["context_id"].(string)
	s.message(t)
	finishContext(s, id)
	first := <-firstRead
	equal(t, first.err, nil)
	equal(t, first.item, out.SynthesisItemAsOrdered{Value: out.VoiceAiEnvelope{Audio: []byte{0, 255, 128}, CorrelationId: id}})
	item, err := input.Next(deadline(t))
	equal(t, err, nil)
	equal(t, item, out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: id}})
	close(release)
	item, err = input.Next(deadline(t))
	equal(t, item, nil)
	if err != failure {
		t.Fatalf("got %v; want original write failure", err)
	}
}

func TestInputValidationAndErrorIdentity(t *testing.T) {
	failure := errors.New("producer failed")
	for _, c := range []sourceResult{{err: failure}, {item: (*schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsClear)(nil)}} {
		s, p := newSocket(), newProducer()
		p.values <- c
		input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: s})
		if err != nil {
			t.Fatal(err)
		}
		_, err = input.Next(deadline(t))
		if c.err != nil {
			if err != failure {
				t.Fatalf("got %v; want producer failure", err)
			}
		} else {
			validate, e := schema.ValidateRequest(liveRequest(p))
			if e != nil {
				t.Fatal(e)
			}
			equal(t, err, validate(c.item))
		}
		input.Close()
		await(t, p.closed)
		equal(t, s.sends.Load(), int32(0))
	}
}

func TestCancellationClosesPendingReadsWritesAndProducerCleanup(t *testing.T) {
	for _, where := range []string{"read", "write", "input", "cleanup"} {
		t.Run(where, func(t *testing.T) {
			s, p := newSocket(), newProducer()
			release := make(chan struct{})
			defer close(release)
			if where == "write" {
				s.write = func(ctx context.Context, _ map[string]any) error { <-ctx.Done(); return ctx.Err() }
			}
			if where == "cleanup" {
				p.cleanup = func() { <-release }
			}
			if where != "input" {
				p.values <- sourceResult{item: schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString{Value: "Hello"}}
			}
			ctx, cancel := context.WithCancel(deadline(t))
			defer cancel()
			input, err := Synthesize(ctx, liveRequest(p), Options{Auth: authenticated(), WebSocket: s})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			ch := consume(t, input)
			if where != "input" {
				s.message(t)
			} else {
				// Input ownership begins at the boundary after the override is accepted.
				p.values <- sourceResult{item: schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString{Value: "ready"}}
				s.message(t)
			}
			cancel()
			got := <-ch
			equal(t, got.err, context.Canceled)
			await(t, s.closed)
			await(t, p.closed)
			equal(t, s.closes.Load(), int32(1))
		})
	}
}
