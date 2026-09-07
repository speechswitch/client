package resemble

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	out "github.com/speechswitch/client/sdks/go/generated/resemble_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestNativeHTTPUploadQueueAndEarlyDownload(t *testing.T) {
	queueClosed, downloadClosed := make(chan struct{}), make(chan struct{})
	calls := make(chan string, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls <- r.Method + " " + r.URL.RequestURI()
		if r.Header.Get("Authorization") != "Bearer fixture" || r.Header.Get("Cookie") != "" {
			t.Errorf("credentials %#v", r.Header)
		}
		switch r.URL.Path {
		case "/prefix/gradio_api/upload":
			reader, err := r.MultipartReader()
			if err != nil {
				t.Error(err)
				http.Error(w, "multipart", 400)
				return
			}
			part, err := reader.NextPart()
			if err != nil {
				t.Error(err)
				return
			}
			data, err := io.ReadAll(part)
			if err != nil {
				t.Error(err)
				return
			}
			if !reflect.DeepEqual(data, []byte{0, 255, 128}) || part.FileName() != "reference.audio" || part.FormName() != "files" || part.Header.Get("Content-Type") != "application/octet-stream" {
				t.Errorf("multipart %x %#v", data, part.Header)
			}
			if _, err := reader.NextPart(); err != io.EOF {
				t.Error(err)
			}
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `["/uploaded/reference"]`)
		case "/prefix/gradio_api/call/generate_tts_audio":
			var got any
			if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
				t.Error(err)
				return
			}
			want := map[string]any{"data": []any{"Hello", map[string]any{"path": "/uploaded/reference", "meta": map[string]any{"_type": "gradio.FileData"}}, 0.5, 0.8, float64(0), 0.5, false}}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("wire %#v", got)
			}
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, submitted)
		case "/prefix/gradio_api/call/generate_tts_audio/event/?#雪":
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, completion)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			close(queueClosed)
		case "/prefix/gradio_api/file=/tmp/gradio/file with?#雪.wav":
			w.Header().Set("Content-Type", "audio/wav")
			w.Write([]byte{0, 255, 128})
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			close(downloadClosed)
		default:
			t.Errorf("unexpected path %s", r.URL)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	r := baseRequest()
	r.Value.ReferenceAudio = runtime.Some([]byte{0, 255, 128})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	audio, err := Synthesize(ctx, r, Options{Auth: authenticated(), BaseURL: server.URL + "/prefix?tenant=one;two&x=%2F"})
	if err != nil {
		t.Fatal(err)
	}
	defer audio.Close()
	item, err := audio.Next(context.Background())
	if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}) {
		t.Fatal(item, err)
	}
	await(t, queueClosed)
	select {
	case <-downloadClosed:
		t.Fatal("download closed before consumer exit")
	default:
	}
	if err := audio.Close(); err != nil {
		t.Fatal(err)
	}
	await(t, downloadClosed)
	expected := []string{"POST /prefix/gradio_api/upload?tenant=one;two&x=%2F", "POST /prefix/gradio_api/call/generate_tts_audio?tenant=one;two&x=%2F", "GET /prefix/gradio_api/call/generate_tts_audio/event%2F%3F%23%E9%9B%AA?tenant=one;two&x=%2F", "GET /prefix/gradio_api/file=%2Ftmp%2Fgradio%2Ffile%20with%3F%23%E9%9B%AA.wav?tenant=one;two&x=%2F"}
	got := []string{}
	for range expected {
		got = append(got, <-calls)
	}
	if !reflect.DeepEqual(got, expected) {
		t.Fatal(got)
	}
}

func TestNativeHTTPRedirectsNeverReplay(t *testing.T) {
	var replayed atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { replayed.Add(1); w.Write([]byte("audio")) }))
	defer destination.Close()
	for _, stage := range []string{"submit", "queue", "download"} {
		t.Run(stage, func(t *testing.T) {
			var count atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				index := count.Add(1)
				if index == 1 && stage != "submit" {
					w.Header().Set("Content-Type", "application/json")
					io.WriteString(w, submitted)
					return
				}
				if index == 2 && stage == "download" {
					w.Header().Set("Content-Type", "text/event-stream")
					io.WriteString(w, completion)
					return
				}
				w.Header().Set("Location", destination.URL)
				w.WriteHeader(307)
				io.WriteString(w, "redirect")
			}))
			defer server.Close()
			audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), BaseURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			_, err = audio.Next(context.Background())
			audio.Close()
			want := &Error{StatusCode: runtime.Some(307), Body: "redirect"}
			if stage != "submit" {
				want.RequestID = runtime.Some("event/?#雪")
			}
			if !reflect.DeepEqual(err, want) {
				t.Fatal(err, want)
			}
			expected := map[string]int32{"submit": 1, "queue": 2, "download": 3}[stage]
			if count.Load() != expected {
				t.Fatal(count.Load())
			}
		})
	}
	if replayed.Load() != 0 {
		t.Fatal("redirect replayed", replayed.Load())
	}
}

func TestNativeHTTPSOffOriginFileReceivesNoCredentials(t *testing.T) {
	captured := make(chan http.Header, 1)
	asset := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured <- r.Header.Clone()
		w.Header().Set("Content-Type", "audio/wav")
		w.Write([]byte{0, 255, 128})
	}))
	defer asset.Close()
	var count atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Errorf("API auth %#v", r.Header)
		}
		if count.Add(1) == 1 {
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, submitted)
			return
		}
		file, _ := json.Marshal([]any{map[string]any{"path": "file.wav", "url": asset.URL + "/audio"}})
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "event: complete\ndata: "+string(file)+"\n\n")
	}))
	defer server.Close()
	client := asset.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), BaseURL: server.URL, Transport: client})
	if err != nil {
		t.Fatal(err)
	}
	result, failure := collect(t, audio)
	if failure != "" || len(result) != 2 {
		t.Fatal(result, failure)
	}
	headers := <-captured
	if headers.Get("Authorization") != "" || headers.Get("Cookie") != "" {
		t.Fatal(headers)
	}
	if count.Load() != 2 {
		t.Fatal(count.Load())
	}
}
