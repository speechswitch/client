package elevenlabs

import (
	"context"
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/elevenlabs"
	out "github.com/speechswitch/client/sdks/go/generated/elevenlabs_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestSocketProtocolsPreserveTextAndFlush(t *testing.T) {
	for _, model := range []string{"flash-v2", "flash-v2.5", "multilingual-v2", "eleven-v3"} {
		t.Run(model, func(t *testing.T) {
			src := newSource(text("Hel"), text("lo"), Input(schema.TtsRequestStreamingTextVoice5024de38TextItemAsFlush{}))
			v3src := newSource(dialogueText("Hel"), dialogueText("lo"), DialogueInput(schema.TtsRequestElevenV3StreamingTextVoice145c0c5aTextItemAsFlush{}))
			var r schema.TtsRequest = live(src)
			if model == "flash-v2" {
				v := live(src)
				v.Value.Model = schema.TtsRequestTextVoice814840b5ModelAsFlashV2{}
				r = v
			}
			if model == "multilingual-v2" {
				r = schema.TtsRequestAsMultilingualV2StreamingTextVoice729ee226{Value: schema.TtsRequestMultilingualV2StreamingTextVoice729ee226{Voice: "custom/id", Text: src, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}
			}
			if model == "eleven-v3" {
				r = dialogue(v3src)
			}
			sock := newSocket()
			id := ""
			sock.onSend = func(_ context.Context, v map[string]any) error {
				if v["voice_settings"] != nil {
					id, _ = v["context_id"].(string)
				} else if v["close_socket"] == true {
					sock.receive(map[string]any{"context_id": id, "is_final": true, "audio": "Aw=="})
				} else if v["text"] == "Hel" || v["text"] == "lo" || v["inputs"] != nil {
					sock.receive(map[string]any{"context_id": id, "audio": "AP8="})
				}
				return nil
			}
			s, err := Synthesize(testContext(t), r, Options{Auth: testAuth, WebSocket: sock})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			equal(t, src.pulls.Load(), int32(0))
			equal(t, v3src.pulls.Load(), int32(0))
			values, err := collect(testContext(t), s)
			if err != nil {
				t.Fatal(err)
			}
			equal(t, values, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255}}, out.SynthesisItemAsBytes{Value: []byte{0, 255}}, out.SynthesisItemAsBytes{Value: []byte{3}}})
			if model == "eleven-v3" {
				equalJSON(t, sock.messages(), []map[string]any{{"voices": []string{"custom/id"}, "voice_settings": map[string]any{}, "xi_api_key": "test-key"}, {"inputs": []map[string]string{{"text": "Hel", "voice_id": "custom/id"}}}, {"inputs": []map[string]string{{"text": "lo", "voice_id": "custom/id"}}}, {"flush": true}, {"close_socket": true}})
				equal(t, v3src.closes.Load(), int32(1))
			} else {
				equalJSON(t, sock.messages(), []map[string]any{{"text": " ", "context_id": id, "voice_settings": map[string]any{}, "xi_api_key": "test-key", "generation_config": map[string]any{"chunk_length_schedule": []int{120, 160, 250, 290}}}, {"text": "Hel", "context_id": id}, {"text": "lo", "context_id": id}, {"text": " ", "context_id": id, "flush": true}, {"text": " ", "context_id": id, "flush": true}, {"close_socket": true}})
				equal(t, src.closes.Load(), int32(1))
			}
			equal(t, sock.closes.Load(), int32(1))
		})
	}
}
func TestClearRetiresLateAudioFinalAndErrors(t *testing.T) {
	src := newSource(text("old"), Input(schema.TtsRequestStreamingTextVoice5024de38TextItemAsClear{}), text("new"))
	sock := newSocket()
	ids := []string{}
	sock.onSend = func(_ context.Context, v map[string]any) error {
		if v["voice_settings"] != nil {
			ids = append(ids, v["context_id"].(string))
		} else if v["close_context"] == true {
			sock.receive(map[string]any{"contextId": ids[0], "audio": "AQ=="})
			sock.receive(map[string]any{"contextId": ids[0], "isFinal": true})
			sock.receive(map[string]any{"contextId": ids[0], "error": "late", "code": 500})
		} else if v["text"] == "new" {
			sock.receive(map[string]any{"context_id": ids[1], "audio": "Ag=="})
		} else if v["close_socket"] == true {
			sock.receive(map[string]any{"context_id": ids[1], "audio": "Aw==", "is_final": true})
		}
		return nil
	}
	s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	values, err := collect(testContext(t), s)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, values, []out.SynthesisItem{out.SynthesisItemAsClear{}, out.SynthesisItemAsBytes{Value: []byte{2}}, out.SynthesisItemAsBytes{Value: []byte{3}}})
	equal(t, len(ids), 2)
	if ids[0] == ids[1] {
		t.Fatal("context reused")
	}
	equal(t, src.closes.Load(), int32(1))
	equal(t, sock.closes.Load(), int32(1))
}
func TestSharedSocketTimingsAndFinalAudio(t *testing.T) {
	f := loadFixtures(t)
	for _, fixture := range f.Timing[1:] {
		for _, normalized := range []bool{false, true} {
			if fixture.Protocol == "dialogue" && normalized {
				continue
			}
			src := newSource(text("hi"))
			v3src := newSource(dialogueText("hi"))
			sock := newSocket()
			id := ""
			var r schema.TtsRequest = schema.TtsRequestAsStreamingTextVoiceb9af60c3{Value: schema.TtsRequestStreamingTextVoiceb9af60c3{Model: request().Value.Model, Voice: "custom/id", Text: src, Output: live(src).Value.Output}}
			if normalized {
				v := r.(schema.TtsRequestAsStreamingTextVoiceb9af60c3)
				var kind schema.TtsRequestTextVoice1aa1b026TimestampText = schema.TtsRequestTextVoice1aa1b026TimestampTextAsNormalized{}
				v.Value.TimestampText = runtime.Some(kind)
				r = v
			}
			if fixture.Protocol == "dialogue" {
				r = schema.TtsRequestAsElevenV3StreamingTextVoicec1dc022a{Value: schema.TtsRequestElevenV3StreamingTextVoicec1dc022a{Voice: "custom/id", Text: v3src, Output: live(src).Value.Output}}
			}
			sock.onSend = func(_ context.Context, v map[string]any) error {
				if v["voice_settings"] != nil {
					id, _ = v["context_id"].(string)
				} else if v["close_socket"] == true {
					key := "alignment"
					if normalized {
						key = "normalizedAlignment"
					}
					sock.receive(map[string]any{"context_id": id, "audio": "AP8=", "is_final": true, key: fixture.Alignment})
				}
				return nil
			}
			s, err := Synthesize(testContext(t), r, Options{Auth: testAuth, WebSocket: sock})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			value, err := s.Next(testContext(t))
			if err != nil {
				t.Fatal(err)
			}
			equal(t, sock.closes.Load(), int32(1))
			equal(t, value, out.SynthesisItemAsChunk{Value: out.TimestampedAudio{Audio: []byte{0, 255}, Timestamps: []out.CharacterTimestamp{{Value: "雪", StartTimeMs: 0, EndTimeMs: 20}, {Value: "!", StartTimeMs: 20, EndTimeMs: 40}}}})
			_, err = s.Next(testContext(t))
			equal(t, err, io.EOF)
		}
	}
}
func TestPendingWriteDoesNotBlockAudioOrPrefetch(t *testing.T) {
	src, sock := newSource(text("hi"), text("unread")), newSocket()
	cancelled := make(chan struct{})
	sock.onSend = func(ctx context.Context, v map[string]any) error {
		if v["text"] == "hi" {
			sock.receive(map[string]any{"context_id": v["context_id"], "audio": "AQ=="})
			<-ctx.Done()
			close(cancelled)
			return ctx.Err()
		}
		return nil
	}
	s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	value, err := s.Next(testContext(t))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, value, out.SynthesisItemAsBytes{Value: []byte{1}})
	equal(t, src.pulls.Load(), int32(1))
	s.Close()
	wait(t, cancelled)
	equal(t, src.closes.Load(), int32(1))
	equal(t, sock.closes.Load(), int32(1))
}
func TestCancellationAndUnreadClose(t *testing.T) {
	for _, read := range []bool{false, true} {
		src, sock := newSource(text("")), newSocket()
		src.stall = true
		s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock})
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		if read {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := s.Next(ctx); done <- err }()
			wait(t, src.waiting)
			cancel()
			equal(t, <-done, context.Canceled)
		} else {
			equal(t, src.pulls.Load(), int32(0))
			equal(t, len(sock.messages()), 0)
		}
		s.Close()
		equal(t, src.closes.Load(), int32(1))
		equal(t, sock.closes.Load(), int32(1))
	}
}
func TestIdleHeartbeatAndFailure(t *testing.T) {
	for _, v3 := range []bool{false, true} {
		for _, fail := range []bool{false, true} {
			src, v3src, sock := newSource(text("hi")), newSource(dialogueText("hi")), newSocket()
			src.stall, v3src.stall = true, true
			tick := make(chan struct{})
			var once sync.Once
			original := errors.New("heartbeat write")
			sock.onSend = func(_ context.Context, v map[string]any) error {
				if v["text"] == "hi" || v["inputs"] != nil {
					sock.receive(map[string]any{"context_id": v["context_id"], "audio": "AQ=="})
				} else if v["text"] == "" || v["keep_alive"] == true {
					once.Do(func() { close(tick) })
					if fail {
						return original
					}
				}
				return nil
			}
			var r schema.TtsRequest = live(src)
			if v3 {
				r = dialogue(v3src)
			}
			s, err := Synthesize(testContext(t), r, Options{Auth: testAuth, WebSocket: sock})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			s.(*socketStream).heartbeatInterval = time.Millisecond
			_, err = s.Next(testContext(t))
			if err != nil {
				t.Fatal(err)
			}
			wait(t, tick)
			if fail {
				wait(t, sock.closed)
				_, err = s.Next(testContext(t))
				equal(t, err, original)
			}
			s.Close()
			equal(t, sock.closes.Load(), int32(1))
		}
	}
}
func TestFinalContextRestartsWhileConsumerIdle(t *testing.T) {
	src, sock := newSource(text("hi")), newSocket()
	src.stall = true
	restarted := make(chan struct{})
	ids := []string{}
	sock.onSend = func(_ context.Context, v map[string]any) error {
		if v["voice_settings"] != nil {
			ids = append(ids, v["context_id"].(string))
			if len(ids) == 2 {
				close(restarted)
			}
		} else if v["text"] == "hi" {
			sock.receive(map[string]any{"context_id": ids[0], "audio": "AQ==", "is_final": true})
		}
		return nil
	}
	s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	value, err := s.Next(testContext(t))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, value, out.SynthesisItemAsBytes{Value: []byte{1}})
	wait(t, restarted)
	equal(t, len(ids), 2)
	if ids[0] == ids[1] {
		t.Fatal("context reused")
	}
}
func TestProtocolFailuresAndOriginalIOErrors(t *testing.T) {
	for _, tc := range []struct {
		packet any
		want   string
	}{
		{[]any{}, "Invalid ElevenLabs WebSocket frame"}, {map[string]any{"context_id": "a", "contextId": "b"}, "Conflicting ElevenLabs context identifiers"},
		{map[string]any{"context_id": 12}, "Invalid ElevenLabs context identifier"}, {map[string]any{"is_final": true, "isFinal": false}, "Conflicting ElevenLabs final flags"},
		{map[string]any{"is_final": 12}, "Invalid ElevenLabs final flag"}, {map[string]any{"audio": 12}, "Invalid ElevenLabs audio payload"},
		{map[string]any{"other": true}, "Unknown ElevenLabs WebSocket message"}, {map[string]any{"audio": "AQ=="}, "ElevenLabs multi-context output lacks its context identifier"},
		{map[string]any{"context_id": "wrong", "audio": "AQ=="}, "ElevenLabs returned an unexpected context identifier"},
	} {
		src, sock := newSource(text("")), newSocket()
		src.stall = true
		sock.receive(tc.packet)
		s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock})
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Next(testContext(t))
		s.Close()
		if err == nil {
			t.Fatal("invalid packet accepted")
		}
		equal(t, err.Error(), tc.want)
		equal(t, src.closes.Load(), int32(1))
	}
	for _, lane := range []string{"read", "write"} {
		src, sock := newSource(text("hi")), newSocket()
		src.stall = true
		original := errors.New(lane)
		if lane == "read" {
			sock.incoming <- socketResult{err: original}
		} else {
			sock.onSend = func(context.Context, map[string]any) error { return original }
		}
		s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock})
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Next(testContext(t))
		s.Close()
		equal(t, err, original)
		equal(t, src.closes.Load(), int32(1))
	}
	src, sock := newSource(Input(nil)), newSocket()
	validate, validationError := schema.ValidateRequest(live(src))
	if validationError != nil {
		t.Fatal(validationError)
	}
	expected := validate(Input(nil))
	if expected == nil {
		t.Fatal("generated validator accepted nil input")
	}
	s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Next(testContext(t))
	s.Close()
	if err == nil {
		t.Fatal("adapter accepted nil input")
	}
	equal(t, err.Error(), expected.Error())
}
