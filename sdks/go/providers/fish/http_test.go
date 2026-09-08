package fish

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/fish"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestHTTPSharedWireFixtures(t *testing.T) {
	fixtures := loadFixtures(t)
	for i, r := range requests() {
		t.Run(fixtures.HTTP[i].Name, func(t *testing.T) {
			fixture := fixtures.HTTP[i]
			expected := map[string]any{}
			for k, v := range fixtures.Defaults {
				expected[k] = v
			}
			for k, v := range fixture.Wire {
				expected[k] = v
			}
			b := &body{chunks: [][]byte{{0, 255}, {1}}}
			transport := transportFunc(func(r *http.Request) (*http.Response, error) {
				equal(t, r.Method, "POST")
				equal(t, r.URL.String(), "https://proxy.test/prefix%20path/v1/tts?tenant=one")
				equal(t, r.Header, http.Header{"Authorization": {"Bearer test-key"}, "Model": {fixture.Request["model"].(string)}, "Content-Type": {"application/msgpack"}})
				data, err := io.ReadAll(r.Body)
				if err != nil {
					t.Fatal(err)
				}
				wire, err := runtime.DecodeMessagePack(data)
				if err != nil {
					t.Fatal(err)
				}
				equal(t, wire, expected)
				return &http.Response{StatusCode: 200, Body: b, Header: http.Header{"Content-Type": {"application/json"}}}, nil
			})
			stream, err := Synthesize(testContext(t), r, Options{Auth: testAuth, Transport: transport, BaseURL: "https://proxy.test/prefix%20path/?tenant=one"})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			equal(t, b.reads.Load(), int32(0))
			items, err := collect(testContext(t), stream)
			if err != nil {
				t.Fatal(err)
			}
			equal(t, items, []any{[]byte{0, 255}, []byte{1}})
			equal(t, b.closes.Load(), int32(1))
		})
	}
}

func TestTimelineEveryByteSplit(t *testing.T) {
	fixtures := loadFixtures(t)
	data := []byte{}
	expected := []any{}
	for _, fixture := range fixtures.Timeline {
		packet, err := json.Marshal(fixture.Packet)
		if err != nil {
			t.Fatal(err)
		}
		data = append(data, []byte("data: ")...)
		data = append(data, packet...)
		data = append(data, '\r', '\n', '\r', '\n')
		expected = append(expected, fixture.Item)
	}
	r := request()
	r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestS1TextTimestampGranularity{})
	for split := 0; split <= len(data); split++ {
		b := &body{chunks: [][]byte{data[:split], data[split:]}}
		stream, err := Synthesize(testContext(t), r, Options{Auth: testAuth, Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
			equal(t, req.URL.Path, "/v1/tts/stream/with-timestamp")
			return &http.Response{StatusCode: 200, Body: b, Header: http.Header{}}, nil
		})})
		if err != nil {
			t.Fatal(err)
		}
		items, err := collect(testContext(t), stream)
		stream.Close()
		if err != nil {
			t.Fatalf("split %d: %v", split, err)
		}
		equal(t, items, expected)
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestHTTPFailuresAndOwnership(t *testing.T) {
	sentinel := errors.New("read failed")
	for _, test := range []struct {
		name          string
		status, limit int
		data          string
		bodyError     error
		message       string
	}{
		{"provider", 429, 0, `{"message":"quota","reason":"credits"}`, nil, "Fish 429: quota"},
		{"bounded", 500, 3, "1234", nil, "Fish response exceeds MaxJSONBytes"},
		{"read", 500, 0, "", sentinel, "read failed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			b := &body{chunks: [][]byte{[]byte(test.data)}, err: test.bodyError}
			_, err := Synthesize(testContext(t), request(), Options{Auth: testAuth, Transport: response(b, test.status), MaxJSONBytes: test.limit})
			if err == nil {
				t.Fatal("expected error")
			}
			equal(t, err.Error(), test.message)
			equal(t, b.closes.Load(), int32(1))
			if test.bodyError != nil {
				equal(t, err, test.bodyError)
			}
			if test.name == "provider" {
				var provider *Error
				if !errors.As(err, &provider) {
					t.Fatal(err)
				}
				equal(t, provider.Reason, runtime.Some("credits"))
			}
		})
	}
	b := &body{chunks: [][]byte{{1}}, err: sentinel}
	stream, err := Synthesize(testContext(t), request(), Options{Auth: testAuth, Transport: response(b, 200)})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(testContext(t))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, normalized(item), []byte{1})
	_, err = stream.Next(testContext(t))
	equal(t, err, sentinel)
	equal(t, b.closes.Load(), int32(1))
}

func TestNativeHTTPIsIncrementalAndCancelsIdle(t *testing.T) {
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("Model") != "s2-pro" {
			t.Error("missing native authentication/model headers")
		}
		w.Write([]byte{1, 2})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(testContext(t))
	defer cancel()
	stream, err := Synthesize(ctx, request(), Options{Auth: testAuth, BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(testContext(t))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, normalized(item), []byte{1, 2})
	cancel()
	wait(t, closed)
}

func TestNativeHTTPDoesNotFollowRedirect(t *testing.T) {
	var forwarded bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirected" {
			forwarded = true
		}
		http.Redirect(w, r, "/redirected", 302)
	}))
	defer server.Close()
	_, err := Synthesize(testContext(t), request(), Options{Auth: testAuth, BaseURL: server.URL})
	var provider *Error
	if !errors.As(err, &provider) {
		t.Fatal(err)
	}
	equal(t, provider.StatusCode, 302)
	equal(t, forwarded, false)
}

func TestAlignmentRejectsMalformedKnownFields(t *testing.T) {
	item, err := alignment([]byte(`{"audio_base64":"Af==","content":"a","chunk_seq":0,"chunk_audio_offset_sec":0,"alignment":null}`))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, normalized(item).(map[string]any)["audio"], []byte{1})
	base := []byte(`{"audio_base64":"AQ==","content":"a","chunk_seq":0,"chunk_audio_offset_sec":0,"alignment":null}`)
	for _, test := range []struct{ from, to, message string }{
		{`"AQ=="`, `"!"`, "Fish returned invalid base64 audio"},
		{`"AQ=="`, `"AQ==\n"`, "Fish returned invalid base64 audio"},
		{`"chunk_seq":0`, `"chunk_seq":0.5`, "Fish returned an invalid timestamp event"},
		{`"chunk_audio_offset_sec":0`, `"chunk_audio_offset_sec":1e308`, "Fish returned an invalid timestamp event"},
		{`"alignment":null`, `"alignment":{}`, "Fish returned an invalid alignment snapshot"},
		{`"alignment":null`, `"alignment":{"audio_duration":1e308,"segments":[]}`, "Fish returned an invalid alignment snapshot"},
		{`"alignment":null`, `"alignment":{"audio_duration":1,"segments":[{"text":"a","start":2,"end":1}]}`, "Fish returned an invalid timing segment"},
		{`"content":"a"`, `"content":"\ud800"`, "Fish returned invalid timestamp JSON"},
	} {
		_, err := alignment(bytes.Replace(base, []byte(test.from), []byte(test.to), 1))
		if err == nil {
			t.Fatalf("accepted %s", test.to)
		}
		equal(t, err.Error(), test.message)
	}
}
