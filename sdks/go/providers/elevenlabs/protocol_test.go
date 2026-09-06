package elevenlabs

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	out "github.com/speechswitch/client/sdks/go/generated/elevenlabs_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestBoundedStrictSocketDecoding(t *testing.T) {
	for _, tc := range []struct {
		frame    runtime.WebSocketMessage
		dialogue bool
		limit    int
		want     string
	}{
		{runtime.WebSocketBinary{1}, false, 128, "ElevenLabs returned a non-text WebSocket frame"},
		{runtime.WebSocketText(`{"audio":"AQ=="}`), false, 1, "ElevenLabs message exceeds MaxMessageBytes"},
		{runtime.WebSocketText(`{"audio":NaN}`), false, 128, "ElevenLabs returned invalid JSON"},
		{runtime.WebSocketText(`{"audio":"\ud800"}`), false, 128, "ElevenLabs returned invalid JSON"},
		{runtime.WebSocketText(`{"contextId":"a","context_id":null}`), false, 128, "Conflicting ElevenLabs context identifiers"},
		{runtime.WebSocketText(`{"audio":"AQ==","is_final_audio_for_turn":12}`), true, 128, "Invalid ElevenLabs turn-final flag"},
	} {
		_, err := decode(tc.frame, tc.dialogue, false, tc.limit)
		if err == nil {
			t.Fatal("invalid packet accepted")
		}
		equal(t, err.Error(), tc.want)
	}
	for _, value := range []string{"!", "A", "AQ==\n", "AQ==\r"} {
		_, err := audio(value)
		if err == nil {
			t.Fatal("invalid base64 accepted")
		}
		equal(t, err.Error(), "ElevenLabs returned invalid base64 audio")
	}
	for _, tc := range []struct{ data, protocol, want string }{
		{`[]`, "tts", "Invalid ElevenLabs alignment"},
		{`{"chars":["x"],"charStartTimesMs":[],"charDurationsMs":[1]}`, "tts", "ElevenLabs returned incomplete or mismatched alignment arrays"},
		{`{"chars":["x"],"charStartTimesMs":[true],"charDurationsMs":[1]}`, "tts", "ElevenLabs returned invalid character timing"},
		{`{"chars":["x"],"charStartTimesMs":[1e308],"charDurationsMs":[1e308]}`, "tts", "ElevenLabs returned invalid character timing"},
		{`{"chars":["x"],"char_start_times_ms":[0],"char_durations_ms":[-1]}`, "dialogue", "ElevenLabs returned invalid character timing"},
	} {
		value, err := load([]byte(tc.data))
		if err != nil {
			t.Fatal(err)
		}
		_, err = timestamps(value, tc.protocol)
		if err == nil {
			t.Fatal("invalid alignment accepted")
		}
		equal(t, err.Error(), tc.want)
	}
	packet, err := decode(runtime.WebSocketText(`{"is_final_audio_for_turn":true}`), true, false, 128)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, packet.final, false)
	equal(t, packet.audio.Present, false)
}
func TestBoundaryCopiesMutableBufferSchedule(t *testing.T) {
	src, sock := newSource(text("hi")), newSocket()
	schedule := []float64{50, 500}
	r := live(src)
	r.Value.TextBufferThresholds = runtime.Some(schedule)
	id := ""
	sock.onSend = func(_ context.Context, v map[string]any) error {
		if v["voice_settings"] != nil {
			id = v["context_id"].(string)
		} else if v["close_socket"] == true {
			sock.receive(map[string]any{"context_id": id, "is_final": true})
		}
		return nil
	}
	s, err := Synthesize(testContext(t), r, Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	schedule[0] = 1
	_, err = collect(testContext(t), s)
	if err != nil {
		t.Fatal(err)
	}
	equalJSON(t, sock.messages()[0]["generation_config"], map[string]any{"chunk_length_schedule": []float64{50, 500}})
}
func TestEmptyInputAndOversizedInitialization(t *testing.T) {
	for _, limit := range []int{0, 16} {
		src, sock := newSource(text("")), newSocket()
		s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock, MaxMessageBytes: limit})
		if err != nil {
			t.Fatal(err)
		}
		values, err := collect(testContext(t), s)
		s.Close()
		if limit == 0 {
			if err != nil {
				t.Fatal(err)
			}
			equal(t, values, []out.SynthesisItem{})
			equal(t, len(sock.messages()), 1)
		} else {
			equal(t, err.Error(), "ElevenLabs message exceeds MaxMessageBytes")
			equal(t, len(sock.messages()), 0)
		}
		equal(t, src.closes.Load(), int32(1))
		equal(t, sock.closes.Load(), int32(1))
	}
}
func TestPrematureDialogueFinalDeliversAudioThenFails(t *testing.T) {
	src, sock := newSource(dialogueText("hi")), newSocket()
	src.stall = true
	sock.onSend = func(_ context.Context, v map[string]any) error {
		if v["inputs"] != nil {
			sock.receive(map[string]any{"audio": "AQ==", "is_final": true})
		}
		return nil
	}
	s, err := Synthesize(testContext(t), dialogue(src), Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	value, err := s.Next(testContext(t))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, value, out.SynthesisItemAsBytes{Value: []byte{1}})
	equal(t, sock.closes.Load(), int32(1))
	_, err = s.Next(testContext(t))
	equal(t, err.Error(), "ElevenLabs dialogue ended before input completed")
	_, err = s.Next(testContext(t))
	equal(t, err, io.EOF)
}

type failedInput struct {
	failure error
	closed  bool
}

func (s *failedInput) Next(context.Context) (Input, error) { return nil, s.failure }
func (s *failedInput) Close() error                        { s.closed = true; return nil }
func TestOriginalInputErrorSurvivesCleanup(t *testing.T) {
	original := errors.New("producer failure")
	src := &failedInput{failure: original}
	sock := newSocket()
	s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Next(testContext(t))
	s.Close()
	equal(t, err, original)
	equal(t, src.closed, true)
	equal(t, sock.closes.Load(), int32(1))
}
func TestSocketURLDefaultsAndLogging(t *testing.T) {
	src := newSource(text(""))
	r := live(src)
	c, err := settings(r)
	if err != nil {
		t.Fatal(err)
	}
	u, err := speechURL(c, "", "", "mp3_44100_128", "eleven_flash_v2_5", runtime.Optional[string]{}, true)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, u, "wss://api.elevenlabs.io/v1/text-to-speech/custom%2Fid/multi-stream-input?apply_text_normalization=auto&auto_mode=false&enable_logging=true&enable_ssml_parsing=false&inactivity_timeout=20&model_id=eleven_flash_v2_5&output_format=mp3_44100_128&sync_alignment=false")
}
func TestHTTPJSONStrictUTF8(t *testing.T) {
	for _, data := range [][]byte{[]byte(`{"audio_base64":"AQ=="} {}`), {0xff}} {
		b := &body{chunks: [][]byte{data}}
		s, err := Synthesize(testContext(t), fixtureRequests()[9], Options{Auth: testAuth, Transport: response(b)})
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Next(testContext(t))
		s.Close()
		equal(t, err.Error(), "ElevenLabs returned invalid JSON")
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestBoundedHTTPErrorAndOrdinaryJSON(t *testing.T) {
	for _, status := range []int{200, 429} {
		b := &body{chunks: [][]byte{[]byte(strings.Repeat("x", 33))}}
		s, err := Synthesize(testContext(t), fixtureRequests()[9], Options{Auth: testAuth, MaxJSONBytes: 32, Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: status, Body: b}, nil })})
		if status == 200 {
			if err != nil {
				t.Fatal(err)
			}
			_, err = s.Next(testContext(t))
			s.Close()
		}
		if err == nil {
			t.Fatal("oversized JSON accepted")
		}
		equal(t, err.Error(), "ElevenLabs response exceeds MaxJSONBytes")
		equal(t, b.closes.Load(), int32(1))
	}
}

type slowCloseInput struct {
	*source[Input]
	entered, release chan struct{}
}

func (s *slowCloseInput) Close() error { close(s.entered); <-s.release; return s.source.Close() }
func TestNetworkClosesBeforeBlockedProducerCleanup(t *testing.T) {
	input := newSource(text(""))
	input.stall = true
	src := &slowCloseInput{source: input, entered: make(chan struct{}), release: make(chan struct{})}
	sock := newSocket()
	s, err := Synthesize(testContext(t), live(src), Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	result, closed := make(chan error, 1), make(chan error, 1)
	go func() { _, err := s.Next(testContext(t)); result <- err }()
	wait(t, input.waiting)
	go func() { closed <- s.Close() }()
	wait(t, src.entered)
	select {
	case <-sock.closed:
	default:
		t.Error("producer cleanup preceded network release")
	}
	close(src.release)
	equal(t, <-closed, nil)
	equal(t, <-result, context.Canceled)
	equal(t, input.closes.Load(), int32(1))
	equal(t, sock.closes.Load(), int32(1))
}
