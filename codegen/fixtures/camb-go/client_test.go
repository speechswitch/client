package camb

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/speechswitch/client/sdks/go/runtime"
)

type transport struct{ calls []*http.Request }

func (s *transport) Do(request *http.Request) (*http.Response, error) {
	s.calls = append(s.calls, request)
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("audio")), Header: http.Header{}}, nil
}

func TestMutatedHTTPContract(t *testing.T) {
	client := &transport{}
	// This literal must compile against the mutated, not the original text type.
	request := HttpInput{Text: 8, VoiceId: 1, Language: "en-us", ExtraFlag: true}
	response, err := StreamSpeech(context.Background(), request, "key", DefaultBaseURL+"/?trace=1", client)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if len(client.calls) != 1 {
		t.Fatalf("calls = %d", len(client.calls))
	}
	sent := client.calls[0]
	data, err := io.ReadAll(sent.Body)
	if err != nil {
		t.Fatal(err)
	}
	var body any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(body, map[string]any{"text": float64(8), "voice_id": float64(1), "language": "en-us", "extra_flag": true}) {
		t.Fatalf("body = %#v", body)
	}
	if sent.Method != "POST" || sent.URL.String() != "https://new.invalid/api/new-tts?trace=1" || !reflect.DeepEqual(sent.Header, http.Header{"New-Key": {"key"}, "Content-Type": {"application/json"}}) {
		t.Fatalf("request = %#v", sent)
	}
	if DefaultWebSocketURL != "wss://live.invalid/apis/live-tts/ws" {
		t.Fatal(DefaultWebSocketURL)
	}
	for _, input := range []map[string]any{
		{"text": "hello", "voice_id": float64(1), "language": "en-us", "extra_flag": true},
		{"text": float64(8), "voice_id": float64(1), "language": "en-us"},
		{"text": float64(4), "voice_id": float64(1), "language": "en-us", "extra_flag": true},
		{"text": float64(10), "voice_id": float64(1), "language": "en-us", "extra_flag": true},
		{"text": true, "voice_id": float64(1), "language": "en-us", "extra_flag": true},
	} {
		_, err := ParseHttpInput(input)
		if err == nil || err.Error() != "Invalid CAMB HTTP synthesis request" {
			t.Fatalf("error = %v for %#v", err, input)
		}
	}
	request.Text = 4
	if _, err := StreamSpeech(context.Background(), request, "key", DefaultBaseURL, client); err == nil || err.Error() != "Invalid CAMB HTTP synthesis request" {
		t.Fatalf("error = %v", err)
	}
	if len(client.calls) != 1 {
		t.Fatalf("invalid request sent; calls = %d", len(client.calls))
	}
}

func TestMutatedMessages(t *testing.T) {
	for _, text := range []string{
		`{"type":"added","count":3,"items":[{"value":"hello"}]}`,
		`{"type":"added","count":3,"items":[],"nickname":null}`,
		`{"type":"added","count":3.0,"items":[],"nickname":"😀x","a-b":{"flag":true},"a_b":{"flag":2.5}}`,
		`{"type":"added","count":3,"items":[],"choice":"hi"}`,
		`{"type":"added","count":3,"items":[],"choice":5}`,
	} {
		decoded, err := DecodeMessage(runtime.WebSocketText(text))
		if err != nil {
			t.Fatal(err)
		}
		value, ok := decoded.(Added)
		if !ok || value.Count != 3 {
			t.Fatalf("message = %#v", decoded)
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var expected, actual any
		if err := json.Unmarshal([]byte(text), &expected); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(encoded, &actual); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actual, expected) {
			t.Fatalf("roundtrip: %#v != %#v", actual, expected)
		}
	}
	for _, text := range []string{
		`{"type":"added","count":3.5,"items":[]}`,
		`{"type":"added","count":true,"items":[]}`,
		`{"type":"added","count":3,"items":[],"nickname":"😀"}`,
		`{"type":"added","count":3,"items":[],"nickname":"abc"}`,
		`{"type":"added","count":3,"items":[null]}`,
		`{"type":"added","count":3,"items":[{}]}`,
		`{"type":"added","count":3,"items":[],"extra":true}`,
		`{"type":"added","count":3,"items":[],"a_b":{"flag":false}}`,
		`{"type":"session.done","extra":NaN}`,
		`{"type":"added","count":3,"items":[],"nickname":"\ud800x"}`,
		`{"type":"added","count":3,"items":[],"choice":4}`,
		`{"type":"added","count":3,"items":[],"choice":true}`,
		`{"type":"added","count":3,"items":[],"choice":"x"}`,
	} {
		if _, err := DecodeMessage(runtime.WebSocketText(text)); err == nil || err.Error() != "Invalid CAMB WebSocket message" {
			t.Fatalf("error = %v for %s", err, text)
		}
	}
	data := runtime.WebSocketBinary{0, 255}
	message, err := DecodeMessage(data)
	if err != nil || !reflect.DeepEqual(message, AudioChunk{0, 255}) {
		t.Fatalf("binary = %#v, %v", message, err)
	}
	if _, err := EncodeMessage(TextChunk{Type: "text.chunk", Text: string([]byte{255})}); err == nil || err.Error() != "Invalid CAMB WebSocket input" {
		t.Fatalf("invalid UTF8 = %v", err)
	}
}
