package google_rest_test

import (
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	wire "github.com/speechswitch/client/sdks/go/clients/google_rest"
	beta "github.com/speechswitch/client/sdks/go/clients/google_rest_beta"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type transport struct {
	calls    []*http.Request
	response *http.Response
}

func (t *transport) Do(request *http.Request) (*http.Response, error) {
	t.calls = append(t.calls, request)
	return t.response, nil
}

type body struct{ reads, closes int }

func (b *body) Read([]byte) (int, error) { b.reads++; return 0, errors.New("unexpected body read") }
func (b *body) Close() error             { b.closes++; return nil }

func TestWireRequestPresenceAndResponseOwnership(t *testing.T) {
	stream := &body{}
	transport := &transport{response: &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": {"1"}}, Body: stream}}
	headers := http.Header{"authorization": {"Bearer test"}, "Content-Type": {"bad"}}
	value := wire.SynthesizeSpeechRequest{
		AdvancedVoiceOptions: runtime.Some(wire.AdvancedVoiceOptions{EnableTextnorm: runtime.Some(false)}),
		AudioConfig:          runtime.Some(wire.AudioConfig{AudioEncoding: runtime.Some(wire.AudioConfigAudioEncoding(wire.AudioConfigAudioEncodingMP3{})), VolumeGainDb: runtime.Some(float64(0)), EffectsProfileId: runtime.Some([]string{})}),
		Input:                runtime.Some(wire.SynthesisInput{Text: runtime.Some("Acme 日本")}),
		Voice:                runtime.Some(wire.VoiceSelectionParams{LanguageCode: runtime.Some("en-US"), VoiceClone: runtime.Some(wire.VoiceCloneParams{VoiceCloningKey: runtime.Some("existing")})}),
	}
	response, err := wire.SynthesizeSpeech(context.Background(), value, wire.ClientOptions{BaseURL: "https://proxy.invalid/g%2Fp/?tenant=one&blank=", Headers: headers, Transport: transport})
	if err != nil || response != transport.response || stream.reads != 0 || stream.closes != 0 || len(transport.calls) != 1 {
		t.Fatalf("response ownership: %v %v", response, err)
	}
	request := transport.calls[0]
	data, err := io.ReadAll(request.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"advancedVoiceOptions":{"enableTextnorm":false},"audioConfig":{"audioEncoding":"MP3","effectsProfileId":[],"volumeGainDb":0},"input":{"text":"Acme 日本"},"voice":{"languageCode":"en-US","voiceClone":{"voiceCloningKey":"existing"}}}` {
		t.Fatalf("body: %s", data)
	}
	if request.Method != "POST" || request.URL.String() != "https://proxy.invalid/g%2Fp/v1/text:synthesize?blank=&tenant=one" || !reflect.DeepEqual(request.Header, http.Header{"Authorization": {"Bearer test"}, "Content-Type": {"application/json"}}) {
		t.Fatalf("request: %s %s %v", request.Method, request.URL, request.Header)
	}
	if !reflect.DeepEqual(headers, http.Header{"authorization": {"Bearer test"}, "Content-Type": {"bad"}}) {
		t.Fatalf("mutated headers: %v", headers)
	}
	response.Body.Close()
	if stream.closes != 1 {
		t.Fatal("caller could not close response")
	}
}

func TestQueryReplacementAndBetaEndpoint(t *testing.T) {
	transport := &transport{response: &http.Response{StatusCode: 200, Body: &body{}}}
	_, err := wire.ListVoices(context.Background(), wire.ListVoicesInput{LanguageCode: runtime.Some("en US")}, wire.ClientOptions{BaseURL: "https://proxy.invalid/g/?tenant=a&languageCode=old&tenant=b&languageCode=older", Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	if call := transport.calls[0]; call.Method != "GET" || call.URL.String() != "https://proxy.invalid/g/v1/voices?languageCode=en+US&tenant=a&tenant=b" || call.ContentLength != 0 {
		t.Fatalf("query: %#v", call)
	}
	_, err = beta.SynthesizeSpeech(context.Background(), beta.SynthesizeSpeechRequest{Input: runtime.Some(beta.SynthesisInput{Markup: runtime.Some("hello")})}, beta.ClientOptions{BaseURL: beta.DefaultBaseURL, Transport: transport})
	if err != nil || transport.calls[1].URL.String() != "https://texttospeech.googleapis.com/v1beta1/text:synthesize" {
		t.Fatalf("beta route: %v, %v", transport.calls, err)
	}
}

func TestWireErrorsBeforeTransport(t *testing.T) {
	transport := &transport{}
	for _, value := range []wire.SynthesizeSpeechRequest{
		{AudioConfig: runtime.Some(wire.AudioConfig{VolumeGainDb: runtime.Some(math.NaN())})},
		{AudioConfig: runtime.Some(wire.AudioConfig{AudioEncoding: runtime.Some(wire.AudioConfigAudioEncoding((*wire.AudioConfigAudioEncodingMP3)(nil)))})},
		{Input: runtime.Some(wire.SynthesisInput{Text: runtime.Some("\xff")})},
	} {
		_, err := wire.SynthesizeSpeech(context.Background(), value, wire.ClientOptions{BaseURL: wire.DefaultBaseURL, Transport: transport})
		if err == nil || err.Error() != "Invalid Google synthesizeSpeech input" {
			t.Fatalf("invalid request: %v", err)
		}
	}
	for _, target := range []string{"ftp://proxy.invalid", "https://user:pass@proxy.invalid", "https://proxy.invalid/#fragment", "/relative"} {
		_, err := wire.SynthesizeSpeech(context.Background(), wire.SynthesizeSpeechRequest{}, wire.ClientOptions{BaseURL: target, Transport: transport})
		if err == nil || err.Error() != "Google BaseURL must be an HTTP(S) URL without credentials or a fragment" {
			t.Fatalf("%s: %v", target, err)
		}
	}
	if len(transport.calls) != 0 {
		t.Fatalf("invalid input reached transport: %v", transport.calls)
	}
}

type pendingTransport struct{ entered chan struct{} }

func (p pendingTransport) Do(request *http.Request) (*http.Response, error) {
	close(p.entered)
	<-request.Context().Done()
	return nil, request.Context().Err()
}
func TestTransportCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := pendingTransport{entered: make(chan struct{})}
	done := make(chan error, 1)
	go func() {
		_, err := wire.SynthesizeSpeech(ctx, wire.SynthesizeSpeechRequest{}, wire.ClientOptions{BaseURL: wire.DefaultBaseURL, Transport: transport})
		done <- err
	}()
	<-transport.entered
	cancel()
	if err := <-done; err != context.Canceled {
		t.Fatalf("cancellation: %v", err)
	}
}

func TestNativeHTTPReturnsAtHeadersAndClosesUnfinishedBody(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(disconnected)
		data, err := io.ReadAll(r.Body)
		if err != nil || r.Method != "POST" || r.URL.Path != "/g/v1/text:synthesize" || r.Header.Get("X-Goog-Api-Key") != "test" || string(data) != `{"input":{"text":"hello"}}` {
			t.Errorf("native request: %s %s %s %v", r.Method, r.URL, data, err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := wire.SynthesizeSpeech(ctx, wire.SynthesizeSpeechRequest{Input: runtime.Some(wire.SynthesisInput{Text: runtime.Some("hello")})}, wire.ClientOptions{BaseURL: server.URL + "/g", Headers: http.Header{"X-Goog-Api-Key": {"test"}}, Transport: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-disconnected:
	case <-ctx.Done():
		t.Fatal("closing unread response did not disconnect")
	}
}

func TestResponseDecoders(t *testing.T) {
	for _, input := range []string{`null`, `{"audioContent":null}`, `{"audioContent":42}`, `{"audioContent":"\ud800"}`, `{"audioContent":"\xff"}`, `{} {}`} {
		_, err := wire.DecodeSynthesizeSpeechResponse([]byte(input))
		if err == nil || err.Error() != "Invalid Google synthesizeSpeech response" {
			t.Fatalf("%s: %v", input, err)
		}
	}
	response, err := wire.DecodeSynthesizeSpeechResponse([]byte(`{"audioContent":"","ignored":true}`))
	if err != nil || !response.AudioContent.Present || response.AudioContent.Value != "" {
		t.Fatalf("empty audio: %v %v", response, err)
	}
	response, err = wire.DecodeSynthesizeSpeechResponse([]byte(`{}`))
	if err != nil || response.AudioContent.Present {
		t.Fatalf("absent audio: %v %v", response, err)
	}
	voices, err := wire.DecodeListVoicesResponse([]byte(`{"voices":[{"name":"Kore","languageCodes":["en-US"],"naturalSampleRateHertz":24000,"ssmlGender":"FEMALE"}]}`))
	if err != nil || !voices.Voices.Present || len(voices.Voices.Value) != 1 || voices.Voices.Value[0].NaturalSampleRateHertz.Value != 24000 {
		t.Fatalf("voices: %v %v", voices, err)
	}
	for _, rate := range []string{"null", "true", "1.5", "2147483648", "1e1000"} {
		_, err := wire.DecodeListVoicesResponse([]byte(strings.ReplaceAll(`{"voices":[{"naturalSampleRateHertz":RATE}]}`, "RATE", rate)))
		if err == nil || err.Error() != "Invalid Google listVoices response" {
			t.Fatalf("%s: %v", rate, err)
		}
	}
}
