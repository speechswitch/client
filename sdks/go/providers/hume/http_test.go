package hume

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/hume"
	out "github.com/speechswitch/client/sdks/go/generated/hume_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestHTTPModelsMatchSharedFixtures(t *testing.T) {
	fixtures := loadFixtures(t)
	for _, pointers := range []bool{false, true} {
		for i, request := range requests() {
			t.Run(fmt.Sprintf("%d/pointer=%t", i, pointers), func(t *testing.T) {
				if pointers {
					request = pointer(request)
				}
				b := &body{Reader: bytes.NewReader([]byte{0, 255})}
				stream, err := Synthesize(context.Background(), request, Options{Auth: testAuth, Transport: transport(func(r *http.Request) (*http.Response, error) {
					equal(t, r.Method, "POST")
					equal(t, r.URL.String(), "https://api.hume.ai/v0/tts/stream/file")
					equal(t, r.Header, http.Header{"Content-Type": {"application/json"}, "X-Hume-Api-Key": {"test-key"}})
					data, err := io.ReadAll(r.Body)
					if err != nil {
						t.Fatal(err)
					}
					equal(t, decodeJSON(t, data), fixtures.HTTP[i].Body)
					return &http.Response{StatusCode: 200, Body: b}, nil
				})})
				if err != nil {
					t.Fatal(err)
				}
				items, err := collect(stream)
				if err != nil {
					t.Fatal(err)
				}
				equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255}}})
				equal(t, b.closes.Load(), int32(1))
			})
		}
	}
}

func TestHTTPTimelineEveryByteBoundary(t *testing.T) {
	f := loadFixtures(t)
	data := []byte("\xef\xbb\xbf\r\n")
	expected := []any{}
	for i, fixture := range f.Timeline {
		data = append(data, mustJSON(t, fixture.Packet)...)
		if i != len(f.Timeline)-1 {
			data = append(data, '\r', '\n')
		}
		expected = append(expected, fixture.Item)
	}
	for split := 0; split <= len(data); split++ {
		b := newSource([][]byte{data[:split], data[split:]})
		stream := &httpStream{ctx: context.Background(), body: b, metadata: true, first: true, limit: len(data)}
		items, err := collect(stream)
		if err != nil {
			t.Fatalf("split %d: %v", split, err)
		}
		actual := []any{}
		for _, item := range items {
			actual = append(actual, fixtureItem(t, item))
		}
		equal(t, actual, expected)
		wait(t, b.closed)
	}
}

func TestHTTPMetadataOnOctave1(t *testing.T) {
	f := loadFixtures(t)
	b := &body{Reader: bytes.NewReader(mustJSON(t, f.Timeline[1].Packet))}
	stream, err := Synthesize(context.Background(), requests()[0], Options{Auth: testAuth, IncludeMetadata: true, Transport: transport(func(r *http.Request) (*http.Response, error) {
		equal(t, r.URL.Path, "/v0/tts/stream/json")
		return &http.Response{StatusCode: 200, Body: b}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(stream)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, len(items), 1)
	equal(t, fixtureItem(t, items[0]), f.Timeline[1].Item)
}

func TestHTTPErrorDetailsAndBounds(t *testing.T) {
	for _, tc := range []struct {
		name, data, message string
		limit               int
		code                runtime.Optional[string]
	}{
		{"json", `{"message":"denied","error":"fallback","code":"bad_key"}`, "denied", 100, runtime.Some("bad_key")},
		{"error", `{"error":"rejected","code":3}`, "rejected", 100, runtime.Optional[string]{}},
		{"text", "\xef\xbb\xbfno\xff", "no\ufffd", 100, runtime.Optional[string]{}},
		{"limit", "12345", "Hume response exceeds MaxJSONBytes", 4, runtime.Optional[string]{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b := &body{Reader: strings.NewReader(tc.data)}
			_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, MaxJSONBytes: tc.limit, Transport: responseTransport(b, 401)})
			errorText(t, err, tc.message)
			if tc.name != "limit" {
				equal(t, err, &Error{Message: tc.message, StatusCode: runtime.Some(401), Code: tc.code})
			}
			equal(t, b.closes.Load(), int32(1))
		})
	}
	for _, data := range []string{"12345", "12345\n"} {
		b := &body{Reader: strings.NewReader(data)}
		stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, IncludeMetadata: true, MaxJSONBytes: 4, Transport: responseTransport(b, 200)})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, "Hume JSON line exceeds MaxJSONBytes")
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestHTTPStreamingAndCancellation(t *testing.T) {
	for _, mode := range []string{"parent", "pull", "close"} {
		t.Run(mode, func(t *testing.T) {
			reader, writer := io.Pipe()
			defer writer.Close()
			reading := make(chan struct{})
			reads := 0
			b := &body{Reader: readerFunc(func(data []byte) (int, error) {
				reads++
				if reads == 2 {
					close(reading)
				}
				return reader.Read(data)
			}), closeFn: reader.Close}
			parent, cancelParent := context.WithCancel(context.Background())
			defer cancelParent()
			stream, err := Synthesize(parent, request(), Options{Auth: testAuth, Transport: responseTransport(b, 200)})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			written := make(chan struct{})
			go func() { defer close(written); _, _ = writer.Write([]byte{1, 2}) }()
			first, err := stream.Next(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			equal(t, first, out.SynthesisItemAsBytes{Value: []byte{1, 2}})
			wait(t, written)
			pull, cancelPull := context.WithCancel(context.Background())
			defer cancelPull()
			finished := make(chan struct{})
			var failure error
			go func() { defer close(finished); _, failure = stream.Next(pull) }()
			wait(t, reading)
			switch mode {
			case "parent":
				cancelParent()
			case "pull":
				cancelPull()
			case "close":
				if err := stream.Close(); err != nil {
					t.Fatal(err)
				}
			}
			wait(t, finished)
			equal(t, failure, context.Canceled)
			equal(t, b.closes.Load(), int32(1))
		})
	}
}

func TestHTTPUnreadCloseAndOriginalErrors(t *testing.T) {
	b := &body{Reader: strings.NewReader("unused")}
	stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, 200)})
	if err != nil {
		t.Fatal(err)
	}
	if err = stream.Close(); err != nil {
		t.Fatal(err)
	}
	equal(t, b.closes.Load(), int32(1))
	_, err = stream.Next(context.Background())
	equal(t, err, io.EOF)
	failure := errors.New("original transport failure")
	_, err = Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) { return nil, failure })})
	if err != failure {
		t.Fatalf("lost error identity: %v", err)
	}
	for _, status := range []int{200, 400} {
		r, w := io.Pipe()
		_ = w.CloseWithError(failure)
		b := &body{Reader: r, closeFn: r.Close}
		stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, status)})
		if status == 200 {
			if err != nil {
				t.Fatal(err)
			}
			_, err = collect(stream)
		}
		if err != failure {
			t.Fatalf("lost body error identity: %v", err)
		}
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestOptionalZeroAndFalseValues(t *testing.T) {
	r := requests()[5].(schema.TtsRequestAsOctave1TextVoiceName)
	r.Value.TrailingSilenceMs = runtime.Some(float64(0))
	r.Value.Instructions = runtime.Some("")
	r.Value.ContextBefore.Present = false
	validate, err := schema.ValidateRequest(r)
	if err != nil {
		t.Fatal(err)
	}
	c, err := settings(r, validate)
	if err != nil {
		t.Fatal(err)
	}
	expected := loadFixtures(t).HTTP[5].Body
	delete(expected, "context")
	u := expected["utterances"].([]any)[0].(map[string]any)
	u["trailing_silence"] = float64(0)
	u["description"] = ""
	equal(t, jsonValue(t, c.body), expected)
	r.Value.Temperature.Present = false
	r.Value.Speed = runtime.Optional[float64]{Value: 999}
	r.Value.SplitTurns.Present = false
	validate, err = schema.ValidateRequest(r)
	if err != nil {
		t.Fatal(err)
	}
	c, err = settings(r, validate)
	if err != nil {
		t.Fatal(err)
	}
	delete(expected, "temperature")
	u["speed"] = float64(1)
	expected["split_utterances"] = true
	equal(t, jsonValue(t, c.body), expected)
}
