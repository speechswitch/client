package kugelaudio

import (
	"context"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
	"github.com/speechswitch/client/sdks/go/runtime"
	"testing"
)

func TestMalformedProtocolPackets(t *testing.T) {
	for _, c := range []struct {
		packet   string
		expected string
	}{
		{`{}`, "KugelAudio returned an invalid event"},
		{`{"final":false}`, "KugelAudio returned an invalid event flag"},
		{`{"final":true,"audio":"AQI="}`, "KugelAudio returned an invalid event"},
		{`{"session_closed":true}`, "KugelAudio ended a turn before final"},
		{`{"interrupted":true}`, "KugelAudio returned an unsolicited interruption"},
		{`{"settings_updated":true,"settings":{}}`, "KugelAudio returned an unsolicited settings acknowledgement"},
		{`{"audio":"AQI=","enc":"pcm_s16le","sr":24000,"samples":2,"idx":0,"chunk_id":0}`, "KugelAudio audio size disagrees with its sample count"},
		{`{"audio":"AQI=","enc":"pcm_s16le","sr":true,"samples":1,"idx":0,"chunk_id":0}`, "KugelAudio returned an unexpected audio format"},
		{`{"audio":"?","enc":"pcm_s16le","sr":24000,"samples":1,"idx":0,"chunk_id":0}`, "KugelAudio returned invalid base64 audio"},
		{`{"word_timestamps":[],"chunk_id":0}`, "KugelAudio returned unrequested timestamps"},
		{`{"final":true,"usage":{"audio_seconds":1,"characters":2,"cost_cents":null}}`, "KugelAudio omitted its cost-unavailable indicator"},
		{`{"final":true,"usage":{"audio_seconds":1,"characters":2,"cost_cents":0,"currency":"usd"}}`, "KugelAudio returned an invalid usage currency"},
		{`{"final":true,"usage":{"audio_seconds":1,"characters":2,"cost_cents":0,"model_id":false}}`, "KugelAudio returned an invalid usage model"},
	} {
		ws := newSocket()
		ws.onSend = func(context.Context, map[string]any) error {
			ws.incoming <- socketResult{value: runtime.WebSocketText(c.packet)}
			return nil
		}
		stream, err := Synthesize(context.Background(), request(), Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, c.expected)
		wait(t, ws.closed)
	}
	ws := newSocket()
	ws.onSend = func(context.Context, map[string]any) error {
		ws.put(map[string]any{"error": "bad voice", "error_code": "VOICE_NOT_FOUND", "code": 404})
		return nil
	}
	stream, err := Synthesize(context.Background(), request(), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(stream)
	var failure *Error
	if !errors.As(err, &failure) {
		t.Fatal(err)
	}
	equal(t, failure, &Error{Message: "bad voice", StatusCode: runtime.Some(404), Code: runtime.Some("VOICE_NOT_FOUND")})
}

func TestAlignmentErrorsRetainExactBounds(t *testing.T) {
	for _, c := range []struct{ packet, expected string }{
		{`{"word_timestamps":[{"word":"Hi","start_ms":20,"end_ms":10,"char_start":0,"char_end":2}],"chunk_id":0}`, "KugelAudio returned reversed alignment bounds"},
		{`{"word_timestamps":[{"word":"Hi","start_ms":0,"end_ms":10,"char_start":3,"char_end":2}],"chunk_id":0}`, "KugelAudio returned reversed alignment bounds"},
		{`{"word_timestamps":[{"word":false,"start_ms":0,"end_ms":10,"char_start":0,"char_end":2}],"chunk_id":0}`, "KugelAudio returned an invalid word"},
		{`{"word_timestamps":[{"word":"Hi","start_ms":0,"end_ms":10,"char_start":0.5,"char_end":2}],"chunk_id":0}`, "KugelAudio returned invalid char_start"},
	} {
		ws := newSocket()
		ws.onSend = func(context.Context, map[string]any) error {
			ws.incoming <- socketResult{value: runtime.WebSocketText(c.packet)}
			return nil
		}
		r := request()
		r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity{})
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, c.expected)
	}
}

func TestValidationPrecedesAuthAndInput(t *testing.T) {
	for _, mutate := range []func(*schema.TtsRequestTextVoice){
		func(r *schema.TtsRequestTextVoice) { r.MaxAudioTokens = runtime.Some(1.5) },
		func(r *schema.TtsRequestTextVoice) { r.Output = nil },
		func(r *schema.TtsRequestTextVoice) {
			r.PronunciationDictionarySelection = runtime.Some(schema.TtsRequestTextVoicePronunciationDictionarySelection{Scope: 1.5})
		},
		func(r *schema.TtsRequestTextVoice) {
			r.PronunciationDictionarySelection = runtime.Some(schema.TtsRequestTextVoicePronunciationDictionarySelection{Scope: 1, Ids: runtime.Some(make([]float64, 51))})
		},
		func(r *schema.TtsRequestTextVoice) {
			r.PronunciationDictionarySelection = runtime.Some(schema.TtsRequestTextVoicePronunciationDictionarySelection{Scope: 1, Ids: runtime.Some([]float64{1.5, 2.5})})
		},
	} {
		r := request()
		mutate(&r.Value)
		_, expected := schema.ValidateRequest(r)
		if expected == nil {
			t.Fatal("invalid fixture passed generated validation")
		}
		_, err := Synthesize(context.Background(), r, Options{})
		errorText(t, err, expected.Error())
	}
	for _, url := range []string{"https://user:secret@host", "https://host:99999", "https://host/%xx", "https://host/?q=%xx", "https://host/#fragment", "https://host/space here"} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: url})
		errorText(t, err, "Invalid KugelAudio endpoint URL")
	}
	for _, voice := range []schema.TtsRequestTextVoiceVoice{schema.TtsRequestTextVoiceVoiceAsNumber{Value: 1.5}, schema.TtsRequestTextVoiceVoiceAsString{Value: " \ufeff"}} {
		r := request()
		r.Value.Voice = voice
		_, err := Synthesize(context.Background(), r, Options{Auth: testAuth})
		errorText(t, err, "KugelAudio voice must be a nonempty handle or an integer ID")
	}
	ws := newSocket()
	source := newSource([]Input{text("unread")})
	stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	wait(t, source.closed)
	wait(t, ws.closed)
	equal(t, source.reads.Load(), int32(0))
	equal(t, ws.messages(), []map[string]any{})
}
