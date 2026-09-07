package xai

import (
	"context"
	"io"
	"math"
	"net/http"
	"strings"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/xai"
	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestGeneratedRequestBoundsAndNilVariantsFailBeforeIO(t *testing.T) {
	invalid := []schema.TtsRequest{nil, (*schema.TtsRequestAsText)(nil)}
	for _, text := range []string{strings.Repeat("😀", 15001), string([]byte{255})} {
		r := request()
		r.Value.Text = text
		invalid = append(invalid, r)
	}
	for _, speed := range []float64{.6, 1.6, math.NaN(), math.Inf(1)} {
		r := request()
		r.Value.Speed = runtime.Some(speed)
		invalid = append(invalid, r)
	}
	for _, output := range []schema.TtsRequestTextOutput{nil, (*schema.TtsRequestTextOutputAsMp3)(nil)} {
		r := request()
		r.Value.Output.Present, r.Value.Output.Value = true, output
		invalid = append(invalid, r)
	}
	for _, items := range [][]schema.TtsRequestTextReplacementsItem{
		{{Pattern: strings.Repeat("a", 101), Replacement: "b"}}, {{Pattern: "a", Replacement: strings.Repeat("😀", 129)}}, make([]schema.TtsRequestTextReplacementsItem, 201),
	} {
		r := request()
		r.Value.Replacements = runtime.Some(items)
		invalid = append(invalid, r)
	}
	var nilSource *producer
	invalid = append(invalid, liveRequest(nilSource))
	for _, r := range invalid {
		socket := newSocket()
		_, err := Synthesize(deadline(t), r, Options{Auth: authenticated(), WebSocket: socket})
		if err == nil {
			t.Fatal("accepted invalid request")
		}
		equal(t, err.Error(), "Invalid xai TTS request")
		equal(t, socket.closes.Load(), int32(1))
		equal(t, socket.sends.Load(), int32(0))
	}
	r := request()
	r.Value.Text = strings.Repeat("😀", 15000)
	r.Value.Replacements = runtime.Some([]schema.TtsRequestTextReplacementsItem{{Pattern: strings.Repeat("a", 100), Replacement: strings.Repeat("😀", 128)}})
	if _, err := schema.ValidateRequest(r); err != nil {
		t.Fatal(err)
	}
}

func TestBoundaryAuthTimeoutsLimitsAndURLs(t *testing.T) {
	t.Setenv("SPEECHSWITCH_XAI_API_KEY", "primary")
	t.Setenv("XAI_API_KEY", "fallback")
	key, err := apiKey(auth.Auth{})
	equal(t, err, nil)
	equal(t, key, "primary")
	key, err = apiKey(authenticated())
	equal(t, err, nil)
	equal(t, key, "fixture")
	for _, c := range []struct{ key, want string }{{"", "Missing auth.xai.apiKey configuration"}, {"bad\nkey", "xAI API key must contain only visible ASCII characters"}, {"bad key", "xAI API key must contain only visible ASCII characters"}} {
		a := authenticated()
		a.Xai.Value.ApiKey = runtime.Some(c.key)
		p, socket := newProducer(), newSocket()
		_, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: a, WebSocket: socket})
		if err == nil {
			t.Fatal("accepted invalid auth")
		}
		equal(t, err.Error(), c.want)
		equal(t, p.reads.Load(), int32(0))
		equal(t, socket.closes.Load(), int32(1))
	}
	for _, base := range []string{"ftp://host", "https://user:pass@host", "https://host/#", "https://host/%zz", "https://host/?x=%xx", "https://host:99999", "https://host:", "https://host\\path"} {
		p, socket := newProducer(), newSocket()
		_, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket, BaseURL: base})
		if err == nil {
			t.Fatal("accepted invalid URL")
		}
		equal(t, err.Error(), "xAI endpoint must be HTTP(S) or WS(S) without credentials, fragments or invalid escapes")
		equal(t, p.reads.Load(), int32(0))
		equal(t, socket.closes.Load(), int32(1))
	}
	for _, timeout := range []int64{-1, 2147483648} {
		_, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), TimeoutMs: runtime.Some(timeout)})
		equal(t, err.Error(), "xAI TimeoutMs must be between 0 and 2147483647")
	}
	_, err = Synthesize(deadline(t), request(), Options{Auth: authenticated(), TimeoutMs: runtime.Some(int64(0))})
	equal(t, err, context.DeadlineExceeded)
	_, err = Synthesize(nil, request(), Options{Auth: authenticated()})
	equal(t, err.Error(), "xAI context is required")
	for _, limit := range []int{-1, 9007199254740992} {
		_, err = Synthesize(deadline(t), request(), Options{Auth: authenticated(), MaxMessageBytes: limit})
		equal(t, err.Error(), "xAI MaxMessageBytes must be a positive safe integer")
		_, err = Synthesize(deadline(t), request(), Options{Auth: authenticated(), MaxResponseBytes: limit})
		equal(t, err.Error(), "xAI MaxResponseBytes must be a positive safe integer")
	}
	socket := newSocket()
	_, err = Synthesize(deadline(t), request(), Options{Auth: authenticated(), WebSocket: socket})
	equal(t, err.Error(), "xAI socket overrides require streaming input")
	equal(t, socket.closes.Load(), int32(1))
}

func TestHTTPStatusContentTypeAndBoundedTimingErrors(t *testing.T) {
	for _, c := range []struct {
		status      int
		media, want string
	}{{401, "application/json", "xAI returned HTTP 401"}, {307, "audio/mpeg", "xAI returned HTTP 307"}, {200, "text/html", "xAI returned an unexpected content type"}} {
		b := &body{chunks: [][]byte{[]byte("private")}}
		input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: c.status, Header: http.Header{"Content-Type": {c.media}}, Body: b}, nil
		})})
		if err != nil {
			t.Fatal(err)
		}
		defer input.Close()
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted invalid response")
		}
		equal(t, err.Error(), c.want)
		equal(t, b.reads.Load(), int32(0))
		equal(t, b.closes.Load(), int32(1))
	}
	for _, c := range []struct{ wire, want string }{
		{`{"audio":"AQ"}`, "Invalid xAI base64 audio"}, {`{"audio":"AQ==","duration":1e308}`, "Invalid xAI audio duration"},
		{`{"audio":"AQ==","audio_timestamps":null}`, "Invalid xAI character timestamps"},
		{`{"audio":"AQ==","audio_timestamps":{"graph_chars":["a"],"graph_times":[[0.2,0.1]]}}`, "Invalid xAI character timestamp interval"},
		{`{"audio":"AQ==","audio_timestamps":{"graph_chars":["a"],"graph_times":[[true,1]]}}`, "Invalid xAI character timestamp interval"},
		{`[]`, "Invalid xAI timestamped audio response"}, {`{"audio":"AQ==","x":"\ud800"}`, "Invalid xAI JSON"},
	} {
		b := &body{chunks: [][]byte{[]byte(c.wire)}}
		r := request()
		r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextTimestampGranularity{})
		input, err := Synthesize(deadline(t), r, Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })})
		if err != nil {
			t.Fatal(err)
		}
		defer input.Close()
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted invalid response")
		}
		equal(t, err.Error(), c.want)
		equal(t, b.closes.Load(), int32(1))
	}
	r := request()
	r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextTimestampGranularity{})
	b := &body{chunks: [][]byte{[]byte("1234"), []byte("5")}}
	input, err := Synthesize(deadline(t), r, Options{Auth: authenticated(), MaxResponseBytes: 4, Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	equal(t, err.Error(), "xAI response exceeds MaxResponseBytes")
}

func TestVoiceDiscoveryPathsNullableLanguageAndValidation(t *testing.T) {
	backend := transportFunc(func(r *http.Request) (*http.Response, error) {
		equal(t, r.Method, "GET")
		equal(t, r.Header, http.Header{"Authorization": {"Bearer fixture"}, "Accept": {"application/json"}})
		wire := `{"voice_id":"custom","name":"Saved","language":"en"}`
		if r.URL.Path == "/v1/tts/voices" {
			wire = `{"voices":[{"voice_id":"eve","name":"Eve","language":null},{"voice_id":"rex","name":"Rex"}]}`
		} else {
			equal(t, r.URL.String(), "https://proxy.test/prefix/v1/tts/voices/%2E%2E%2Fcustom%3F%23%E9%9B%AA")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(wire))}, nil
	})
	values, err := Voices(deadline(t), VoiceOptions{Auth: authenticated(), Transport: backend})
	if err != nil {
		t.Fatal(err)
	}
	var language out.VoiceLanguage = out.VoiceLanguageAsNull{}
	equal(t, values, []out.Voice{{VoiceId: "eve", Name: "Eve", Language: runtime.Some(language)}, {VoiceId: "rex", Name: "Rex"}})
	value, err := Voice(deadline(t), "../custom?#雪", VoiceOptions{Auth: authenticated(), Transport: backend, BaseURL: "https://proxy.test/prefix"})
	if err != nil {
		t.Fatal(err)
	}
	language = out.VoiceLanguageAsString{Value: "en"}
	equal(t, value, out.Voice{VoiceId: "custom", Name: "Saved", Language: runtime.Some(language)})
	for _, c := range []struct{ wire, want string }{{`[]`, "Invalid xAI voice list"}, {`{"voices":null}`, "Invalid xAI voice list"}, {`{"voices":[{}]}`, "Invalid xAI voice"}, {`{"voices":[{"voice_id":"eve","name":"Eve","language":42}]}`, "Invalid xAI voice language"}} {
		b := &body{chunks: [][]byte{[]byte(c.wire)}}
		_, err := Voices(deadline(t), VoiceOptions{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })})
		if err == nil {
			t.Fatal("accepted invalid discovery")
		}
		equal(t, err.Error(), c.want)
		equal(t, b.closes.Load(), int32(1))
	}
	for _, status := range []int{302, 403} {
		b := &body{chunks: [][]byte{[]byte("private")}}
		_, err := Voices(deadline(t), VoiceOptions{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: status, Body: b}, nil })})
		equal(t, err, &Error{Status: runtime.Some(status)})
		equal(t, b.reads.Load(), int32(0))
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestSocketCapsAndDiscoveryCancellation(t *testing.T) {
	for _, sending := range []bool{false, true} {
		p, socket := newProducer(), newSocket()
		if sending {
			p.values <- sourceResult{item: schema.TtsRequestStreamingTextTextItemAsString{Value: "hello"}}
		} else {
			socket.received <- frameResult{frame: runtime.WebSocketText(`{"type":"audio.done"}`)}
		}
		input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket, MaxMessageBytes: 4})
		if err != nil {
			t.Fatal(err)
		}
		defer input.Close()
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted oversized frame")
		}
		equal(t, err.Error(), "xAI message exceeds MaxMessageBytes")
		equal(t, socket.sends.Load(), int32(0))
		equal(t, socket.closes.Load(), int32(1))
	}
	started, closed := make(chan struct{}), make(chan struct{})
	b := &stalledBody{reading: started, closed: closed}
	ctx, cancel := context.WithCancel(deadline(t))
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := Voices(ctx, VoiceOptions{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: b}, nil
		})})
		result <- err
	}()
	await(t, started)
	cancel()
	equal(t, <-result, context.Canceled)
	await(t, closed)
}

func TestPronunciationPreflightDoesNotMergeDistinctUnicodePhrases(t *testing.T) {
	values, err := replacementMap([]schema.TtsRequestTextReplacementsItem{
		{Pattern: "İ", Replacement: "one"}, {Pattern: "i", Replacement: "two"},
		{Pattern: "ΟΣ", Replacement: "three"}, {Pattern: "Οσ", Replacement: "four"},
	})
	equal(t, err, nil)
	equal(t, values, map[string]string{"İ": "one", "i": "two", "ΟΣ": "three", "Οσ": "four"})
}

func TestFullSocketOverridePreservesTrailingSlash(t *testing.T) {
	p, socket := newProducer(), newSocket()
	input, err := Synthesize(deadline(t), liveRequest(p), Options{
		Auth: authenticated(), WebSocket: socket,
		WebSocketURL: "https://proxy.test/custom%2Froute/?tenant=a%2Bb&language=fr",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	equal(t, input.(*stream).config.url, "wss://proxy.test/custom%2Froute/?language=auto&tenant=a%2Bb")
	equal(t, p.reads.Load(), int32(0))
}
