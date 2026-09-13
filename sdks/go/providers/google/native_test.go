package google

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/google"
)

func readFrame(reader io.Reader) ([]byte, error) {
	var prefix [5]byte
	if _, err := io.ReadFull(reader, prefix[:]); err != nil {
		return nil, err
	}
	size := binary.BigEndian.Uint32(prefix[1:])
	if prefix[0] != 0 || size > 65536 {
		return nil, errors.New("invalid test frame")
	}
	data := make([]byte, size)
	_, err := io.ReadFull(reader, data)
	return data, err
}

func TestNativeGRPCProviderBoundary(t *testing.T) {
	for _, clone := range []bool{false, true} {
		t.Run(map[bool]string{false: "stable", true: "beta"}[clone], func(t *testing.T) {
			t.Setenv("SPEECHSWITCH_GOOGLE_API_KEY", "key")
			t.Setenv("SPEECHSWITCH_GOOGLE_ACCESS_TOKEN", "token")
			t.Setenv("SPEECHSWITCH_GOOGLE_QUOTA_PROJECT", "quota")
			frames := make(chan [][]byte, 1)
			disconnected := make(chan struct{})
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				defer close(disconnected)
				version := "v1"
				if clone {
					version = "v1beta1"
				}
				if r.ProtoMajor != 2 || r.Method != "POST" || r.URL.RequestURI() != "/proxy%2Fsegment/google.cloud.texttospeech."+version+".TextToSpeech/StreamingSynthesize?tenant=one" {
					t.Errorf("request: %s %s %s", r.Proto, r.Method, r.URL)
				}
				if r.Header.Get("Authorization") != "Bearer token" || r.Header.Get("X-Goog-Api-Key") != "key" || r.Header.Get("X-Goog-User-Project") != "quota" {
					t.Errorf("auth: %v", r.Header)
				}
				opening, err := readFrame(r.Body)
				if err != nil {
					t.Error(err)
					return
				}
				text, err := readFrame(r.Body)
				if err != nil {
					t.Error(err)
					return
				}
				frames <- [][]byte{opening, text}
				w.Header().Set("Content-Type", "application/grpc")
				w.Header().Set("Trailer", "Grpc-Status")
				// One byte-native protobuf audio message, before the RPC finishes.
				w.Write([]byte{0, 0, 0, 0, 4, 10, 2, 0, 255})
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			server.EnableHTTP2 = true
			server.StartTLS()
			defer server.Close()
			var request schema.TtsRequest = schema.TtsRequestAsObject7d956f3d{Value: testRequest()}
			if clone {
				request = schema.TtsRequestAsChirp3InstantCustomVoicefa2d40ff{Value: schema.TtsRequestChirp3InstantCustomVoicefa2d40ff{Language: enUS, Voice: "existing-key", Text: schema.TtsRequestChirp3Hda92b414cTextAsString{Value: "hello"}, Output: pcm}}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			// No GRPC override: the provider constructs the RPC and native transport.
			stream, err := Synthesize(ctx, request, Options{Transport: server.Client(), GRPCURL: server.URL + "/proxy%2Fsegment/?tenant=one"})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			if data, err := stream.Next(ctx); err != nil || !reflect.DeepEqual(data, []byte{0, 255}) {
				t.Fatalf("early audio: %x %v", data, err)
			}
			observed := <-frames
			if len(observed[0]) == 0 || !reflect.DeepEqual(observed[1], []byte{18, 7, 10, 5, 'h', 'e', 'l', 'l', 'o'}) {
				t.Fatalf("wire: %x", observed)
			}
			stream.Close()
			select {
			case <-disconnected:
			case <-ctx.Done():
				t.Fatal("native call leaked")
			}
		})
	}
}

func TestNativeHTTPReturnsAtHeadersAndCancelsBody(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(disconnected)
		if r.Method != "POST" || r.URL.Path != "/v1/text:synthesize" || r.Header.Get("Authorization") != "Bearer token" {
			t.Errorf("request: %s %s %v", r.Method, r.URL, r.Header)
		}
		io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"audioContent":"`))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r := schema.TtsRequestTextVoice{Model: flash, Language: "en-US", Voice: kore, Text: "hello", Output: wav}
	stream, err := Synthesize(ctx, schema.TtsRequestAsTextVoice{Value: r}, Options{Auth: testAuth, BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	pending := make(chan error, 1)
	nextCtx, nextCancel := context.WithCancel(ctx)
	go func() { _, err := stream.Next(nextCtx); pending <- err }()
	nextCancel()
	select {
	case err := <-pending:
		if err != context.Canceled {
			t.Fatalf("cancel: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("HTTP read leaked")
	}
	select {
	case <-disconnected:
	case <-ctx.Done():
		t.Fatal("HTTP connection leaked")
	}
}

func TestAuthenticationAndOptionResolution(t *testing.T) {
	for _, name := range []string{"SPEECHSWITCH_GOOGLE_API_KEY", "SPEECHSWITCH_GOOGLE_ACCESS_TOKEN", "SPEECHSWITCH_GOOGLE_QUOTA_PROJECT", "GOOGLE_API_KEY", "GOOGLE_OAUTH_ACCESS_TOKEN", "GOOGLE_CLOUD_QUOTA_PROJECT"} {
		t.Setenv(name, "")
	}
	request := schema.TtsRequestAsObject7d956f3d{Value: testRequest()}
	for _, test := range []struct {
		name, message string
		options       Options
	}{
		{"missing auth", "Missing auth.google.apiKey or auth.google.accessToken configuration", Options{GRPC: newGRPC()}},
		{"bad message limit", "Google byte limits must be positive uint32 values", Options{Auth: testAuth, MaxMessageBytes: -1}},
		{"bad json limit", "Google byte limits must be positive uint32 values", Options{Auth: testAuth, MaxJSONBytes: -1}},
		{"URL credentials", "Invalid Google endpoint URL", Options{Auth: testAuth, GRPCURL: "https://secret@example.invalid"}},
		{"bad query", "Invalid Google endpoint query", Options{Auth: testAuth, GRPCURL: "https://example.invalid/?value=%zz"}},
		{"bad port", "Invalid Google endpoint URL", Options{Auth: testAuth, GRPCURL: "https://example.invalid:999999/"}},
		{"opening limit", "Google gRPC message exceeds MaxMessageBytes", Options{Auth: testAuth, GRPC: newGRPC(), MaxMessageBytes: 1}},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.options.Transport = testTransport(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected IO"); return nil, nil })
			stream, err := Synthesize(context.Background(), request, test.options)
			if stream != nil || err == nil || err.Error() != test.message {
				t.Fatalf("options: %v %v", stream, err)
			}
		})
	}
	t.Setenv("GOOGLE_API_KEY", "fallback")
	t.Setenv("SPEECHSWITCH_GOOGLE_API_KEY", "scoped")
	r := schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Model: flash, Language: "en-US", Voice: kore, Text: "hello", Output: wav}}
	for _, explicit := range []bool{false, true} {
		options := Options{Transport: testTransport(func(request *http.Request) (*http.Response, error) {
			want := "scoped"
			if explicit {
				want = "key"
			}
			if request.Header.Get("X-Goog-Api-Key") != want {
				t.Fatalf("key resolution: %v", request.Header)
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		})}
		if explicit {
			options.Auth = testAuth
		}
		stream, err := Synthesize(context.Background(), r, options)
		if err != nil {
			t.Fatal(err)
		}
		stream.Close()
	}
}
