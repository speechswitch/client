package vocu

import (
	"context"
	"math"
	"net/http"
	"os"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/vocu"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func isolatedEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range []string{"SPEECHSWITCH_VOCU_API_KEY", "VOCU_API_KEY", "SPEECHSWITCH_VOCU_ACCESS_TOKEN", "VOCU_ACCESS_TOKEN"} {
		value, present := os.LookupEnv(key)
		t.Cleanup(func() {
			if present {
				os.Setenv(key, value)
			} else {
				os.Unsetenv(key)
			}
		})
		os.Unsetenv(key)
	}
}

func TestAuthenticationPrecedenceAndExplicitEmptyValues(t *testing.T) {
	for _, test := range []struct {
		name, mode, key, token, want, message string
		explicitKey, explicitToken            bool
		env                                   map[string]string
	}{
		{name: "explicit key", explicitKey: true, key: "explicit", want: "explicit", env: map[string]string{"VOCU_API_KEY": "env"}},
		{name: "scoped env", want: "scoped", env: map[string]string{"SPEECHSWITCH_VOCU_API_KEY": "scoped", "VOCU_API_KEY": "fallback"}},
		{name: "fallback env", want: "fallback", env: map[string]string{"VOCU_API_KEY": "fallback"}},
		{name: "explicit session wins env key", mode: "async", explicitToken: true, token: "session", want: "session", env: map[string]string{"VOCU_API_KEY": "env"}},
		{name: "explicit key wins session", mode: "async", explicitKey: true, key: "key", explicitToken: true, token: "session", want: "key"},
		{name: "env key wins env session", mode: "async", want: "key", env: map[string]string{"VOCU_API_KEY": "key", "VOCU_ACCESS_TOKEN": "session"}},
		{name: "scoped session", mode: "async", want: "scoped", env: map[string]string{"SPEECHSWITCH_VOCU_ACCESS_TOKEN": "scoped", "VOCU_ACCESS_TOKEN": "fallback"}},
		{name: "fallback session", mode: "async", want: "fallback", env: map[string]string{"VOCU_ACCESS_TOKEN": "fallback"}},
		{name: "sync does not use session", explicitToken: true, token: "session", message: "Missing auth.vocu.apiKey configuration"},
		{name: "async missing", mode: "async", message: "Missing auth.vocu.apiKey or auth.vocu.accessToken configuration"},
		{name: "empty explicit key", explicitKey: true, message: "Missing auth.vocu.apiKey configuration", env: map[string]string{"VOCU_API_KEY": "env"}},
		{name: "empty explicit session", mode: "async", explicitToken: true, message: "Missing auth.vocu.apiKey or auth.vocu.accessToken configuration", env: map[string]string{"VOCU_API_KEY": "env"}},
		{name: "unsafe key", explicitKey: true, key: "a\r\nx: y", message: "Vocu credential must contain only visible ASCII characters"},
	} {
		t.Run(test.name, func(t *testing.T) {
			isolatedEnvironment(t)
			for key, value := range test.env {
				t.Setenv(key, value)
			}
			a := auth.Auth{}
			a.Vocu.Present = true
			if test.explicitKey {
				a.Vocu.Value.ApiKey = runtime.Some(test.key)
			}
			if test.explicitToken {
				a.Vocu.Value.AccessToken = runtime.Some(test.token)
			}
			calls := 0
			o := Options{Auth: a, Mode: test.mode, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				equal(t, r.Header.Get("Authorization"), "Bearer "+test.want)
				return response(newBody()), nil
			})}
			s, err := Synthesize(context.Background(), request(), o)
			if test.message != "" {
				equal(t, s, nil)
				if err == nil {
					t.Fatal("missing credential failure")
				}
				equal(t, err.Error(), test.message)
				equal(t, calls, 0)
			} else {
				equal(t, err, nil)
				s.Close()
				equal(t, calls, 1)
			}
		})
	}
}

func TestGeneratedValidationRejectsInvalidValuesBeforeIO(t *testing.T) {
	var nilRequest *schema.TtsRequestAsTextVoice9c5ed44a
	cases := []schema.TtsRequest{nil, nilRequest, schema.TtsRequestAsObject42a4f93c{}, schema.TtsRequestAsObject42a4f93c{Value: schema.TtsRequestObject42a4f93c{Segments: []schema.TtsRequestObject42a4f93cSegmentsItem{nil}}}}
	for _, value := range []float64{math.NaN(), math.Inf(1), 0.49, 2.01} {
		r := request()
		r.Value.Speed = runtime.Some(value)
		cases = append(cases, r)
	}
	r := request()
	r.Value.RandomSeed = runtime.Some(.5)
	cases = append(cases, r)
	r = request()
	r.Value.Text = " \n"
	cases = append(cases, r)
	r = request()
	r.Value.EmotionBlend = runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionBlend{Anger: runtime.Some(11.0)})
	cases = append(cases, r)
	r = request()
	r.Value.Language.Present = true
	cases = append(cases, r)
	for _, r := range cases {
		calls := 0
		o := Options{Auth: authConfig(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { calls++; return response(newBody()), nil })}
		s, err := Synthesize(context.Background(), r, o)
		equal(t, s, nil)
		if err == nil {
			t.Fatal("invalid generated request accepted")
		}
		equal(t, err.Error(), "Invalid vocu TTS request")
		equal(t, calls, 0)
	}
}

func TestBoundaryOptionsAndModeConflicts(t *testing.T) {
	for _, test := range []struct {
		edit    func(*Options)
		message string
	}{
		{func(o *Options) { o.Mode = "wrong" }, "Invalid Vocu mode"},
		{func(o *Options) { o.BaseURL = "https://host/?" }, "Vocu base URL must not contain a query"},
		{func(o *Options) { o.BaseURL = "https://host/#" }, "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes"},
		{func(o *Options) { o.BaseURL = "https://u:p@host" }, "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes"},
		{func(o *Options) { o.BaseURL = "ftp://host" }, "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes"},
		{func(o *Options) { o.BaseURL = "https://host:99999" }, "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes"},
		{func(o *Options) { o.BaseURL = "https://host/%zz" }, "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes"},
		{func(o *Options) { o.BaseURL = "https://host/\nx" }, "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes"},
		{func(o *Options) { o.AudioOrigins = []string{"https://host/path"} }, "Vocu AudioOrigins must contain HTTP(S) origins only"},
		{func(o *Options) { o.AudioOrigins = []string{"https://HOST"} }, "Vocu AudioOrigins must contain HTTP(S) origins only"},
		{func(o *Options) { o.PollIntervalMs = runtime.Some(int64(-1)) }, "Vocu polling interval and timeout must be integers between 0 and 2147483647"},
		{func(o *Options) { o.TimeoutMs = runtime.Some(int64(2147483648)) }, "Vocu polling interval and timeout must be integers between 0 and 2147483647"},
		{func(o *Options) { o.MaxMetadataBytes = -1 }, "Vocu MaxMetadataBytes must be a positive safe integer"},
	} {
		calls := 0
		o := Options{Auth: authConfig(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { calls++; return response(newBody()), nil })}
		test.edit(&o)
		s, err := Synthesize(context.Background(), request(), o)
		equal(t, s, nil)
		if err == nil {
			t.Fatal("invalid boundary option accepted")
		}
		equal(t, err.Error(), test.message)
		equal(t, calls, 0)
	}
	for _, test := range []struct {
		request       schema.TtsRequest
		mode, message string
	}{
		{fixtureRequests()[4], "stream", "Vocu segments and text splitting require async synthesis"},
		{fixtureRequests()[5], "http", "Vocu segments and text splitting require async synthesis"},
		{fixtureRequests()[1], "async", "Vocu async synthesis does not support flash latency optimization"},
	} {
		o := options()
		o.Mode = test.mode
		s, err := Synthesize(context.Background(), test.request, o)
		equal(t, s, nil)
		equal(t, err.Error(), test.message)
	}
	o := options()
	o.TimeoutMs = runtime.Some(int64(0))
	s, err := Synthesize(context.Background(), request(), o)
	equal(t, s, nil)
	equal(t, err, context.DeadlineExceeded)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s, err = Synthesize(ctx, request(), options())
	equal(t, s, nil)
	equal(t, err, context.Canceled)
}
