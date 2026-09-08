package minimax

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"testing"
)

func TestHexAndMalformedNativePackets(t *testing.T) {
	p, err := decodePacket([]byte(`{"data":{"audio":"00aAfF8013","status":2}}`))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, p.audio, []byte{0, 170, 255, 128, 19})
	equal(t, p.status, 2)
	for _, hex := range []string{"0", "001", "0g", "0x01", "AA BB", "AA\n", "ＡＡ", "AQI="} {
		data, _ := json.Marshal(map[string]any{"data": map[string]any{"audio": hex}})
		_, err = decodePacket(data)
		errorText(t, err, "MiniMax returned invalid hex audio")
	}
	for _, test := range []struct{ data, message string }{
		{"null", "MiniMax returned an invalid response object"},
		{`{"base_resp":{"status_code":true}}`, "MiniMax returned invalid base_resp.status_code"},
		{`{"data":{"status":true}}`, "MiniMax returned invalid data.status"},
		{`{"is_final":null}`, "MiniMax returned invalid is_final"},
		{`{"extra_info":{"audio_length":0.5}}`, "MiniMax returned invalid audio_length"},
		{`{"extra_info":{"invisible_character_ratio":2}}`, "MiniMax returned invalid invisible_character_ratio"},
	} {
		_, err = decodePacket([]byte(test.data))
		errorText(t, err, test.message)
	}
	for _, test := range []struct{ data, message string }{
		{`{"subtitles":[]}`, "MiniMax subtitles must be a JSON array"},
		{`[{"text":"Hi","time_begin":-1,"time_end":1}]`, "MiniMax returned invalid subtitle time_begin"},
		{`[{"text":"Hi","time_begin":2,"time_end":1}]`, "MiniMax returned reversed subtitle timestamps"},
		{`[{"text":null,"time_begin":0,"time_end":1}]`, "MiniMax returned invalid subtitle text"},
	} {
		_, err = decodeSubtitles([]byte(test.data), "word")
		errorText(t, err, test.message)
	}
}
func TestSocketCorrelationAndCompletionErrors(t *testing.T) {
	for _, test := range []struct {
		packet  map[string]any
		message string
	}{
		{map[string]any{"event": "task_finished"}, "MiniMax ended the session before task_finish"},
		{map[string]any{"event": "task_canceled"}, "MiniMax returned an unsolicited cancel acknowledgement"},
		{map[string]any{"session_id": "other", "data": map[string]any{"audio": "00"}}, "MiniMax returned an unexpected session ID"},
		{map[string]any{"connect_id": "other", "data": map[string]any{"audio": "00"}}, "MiniMax returned an unexpected connection ID"},
	} {
		socket := newSocket()
		socket.hook = func(_ context.Context, v map[string]any) error {
			if v["event"] == "task_continue" {
				socket.reply(test.packet)
			}
			return nil
		}
		input := newSource(text("Hi"))
		input.stall = true
		stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		errorText(t, err, test.message)
		wait(t, input.closed)
		equal(t, socket.closes.Load(), int32(1))
	}
	for _, code := range []int{2204, 2205} {
		socket := newSocket()
		socket.hook = func(_ context.Context, v map[string]any) error {
			if v["event"] == "task_continue" {
				socket.reply(map[string]any{"base_resp": map[string]any{"status_code": code, "status_msg": "queue"}, "data": nil, "extra_info": "unavailable"})
			}
			return nil
		}
		input := newSource(text("Hi"))
		input.stall = true
		stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		var native *Error
		if !errors.As(err, &native) {
			t.Fatal(err)
		}
		equal(t, native.Code, runtime.Some(code))
		equal(t, native.StatusCode, 0)
		equal(t, native.Message, "queue")
		wait(t, input.closed)
	}
	socket := newSocket()
	socket.hook = func(_ context.Context, v map[string]any) error {
		if v["event"] == "task_continue" {
			socket.incoming <- socketMessage{err: io.EOF}
		}
		return nil
	}
	stream, err := Synthesize(context.Background(), streaming(newSource(text("Hi"))), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	_, err = stream.Next(context.Background())
	errorText(t, err, "MiniMax WebSocket closed before task_finished")
}
