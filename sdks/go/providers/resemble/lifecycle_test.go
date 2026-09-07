package resemble

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/resemble"
	out "github.com/speechswitch/client/sdks/go/generated/resemble_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func await(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for transport state")
	}
}

func TestCancelAtEveryStage(t *testing.T) {
	for _, stage := range []string{"upload", "info", "submit", "queue", "download", "error"} {
		for _, headers := range []bool{false, true} {
			for _, cancelWith := range []string{"parent", "next", "close", "deadline"} {
				t.Run(stage+"/"+map[bool]string{false: "body", true: "headers"}[headers]+"/"+cancelWith, func(t *testing.T) {
					request := schema.TtsRequest(baseRequest())
					preliminary := []*http.Response{}
					if stage == "upload" {
						r := baseRequest()
						r.Value.ReferenceAudio = runtime.Some([]byte("audio"))
						request = r
					}
					if stage == "info" {
						request = schema.TtsRequestAsChatterboxTurboText{Value: schema.TtsRequestChatterboxTurboText{Text: "Hello"}}
					}
					if stage == "queue" || stage == "download" {
						preliminary = append(preliminary, reply(submitted, "application/json", 200))
					}
					if stage == "download" {
						preliminary = append(preliminary, reply(completion, "text/event-stream", 200))
					}
					active := newBody()
					active.stall = true
					active.closeError = errors.New("cleanup")
					started := make(chan struct{})
					released := make(chan struct{})
					var count atomic.Int32
					tr := transportFunc(func(r *http.Request) (*http.Response, error) {
						index := int(count.Add(1)) - 1
						if index < len(preliminary) {
							return preliminary[index], nil
						}
						if index > len(preliminary) {
							return nil, errors.New("unexpected retry")
						}
						if headers {
							close(started)
							<-r.Context().Done()
							close(released)
							return nil, r.Context().Err()
						}
						status := 200
						contentType := "application/json"
						if stage == "queue" {
							contentType = "text/event-stream"
						}
						if stage == "download" {
							contentType = "audio/wav"
						}
						if stage == "error" {
							status = 503
						}
						return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {contentType}}, Body: active}, nil
					})
					parent, cancelParent := context.WithCancel(context.Background())
					defer cancelParent()
					next, cancelNext := context.WithCancel(context.Background())
					defer cancelNext()
					options := Options{Auth: authenticated(), Transport: tr}
					if cancelWith == "deadline" {
						options.Timeout = runtime.Some(100 * time.Millisecond)
					}
					audio, err := Synthesize(parent, request, options)
					if err != nil {
						t.Fatal(err)
					}
					defer audio.Close()
					result := make(chan error, 1)
					go func() { _, err := audio.Next(next); result <- err }()
					if headers {
						await(t, started)
					} else {
						await(t, active.reading)
					}
					switch cancelWith {
					case "parent":
						cancelParent()
					case "next":
						cancelNext()
					case "close":
						audio.Close()
					}
					var got error
					select {
					case got = <-result:
					case <-time.After(3 * time.Second):
						t.Fatal("pending Next did not cancel")
					}
					expected := context.Canceled
					if cancelWith == "deadline" {
						expected = context.DeadlineExceeded
					}
					if got != expected {
						t.Fatal(got, expected)
					}
					audio.Close()
					if headers {
						await(t, released)
						if active.closes.Load() != 0 {
							t.Fatal("unowned response closed")
						}
					} else if active.closes.Load() != 1 {
						t.Fatal("body close count", active.closes.Load())
					}
					for _, r := range preliminary {
						if r.Body.(*body).closes.Load() != 1 {
							t.Fatal("preliminary response leaked")
						}
					}
					if int(count.Load()) != len(preliminary)+1 {
						t.Fatal("retried", count.Load())
					}
					if item, err := audio.Next(context.Background()); item != nil || err != io.EOF {
						t.Fatal(item, err)
					}
				})
			}
		}
	}
}

func TestIdleParentCancellationAndIndependentNextContexts(t *testing.T) {
	for _, cancelParentAfterRead := range []bool{false, true} {
		download := newBody(step{data: []byte("first")}, step{data: []byte("second")})
		download.stall = true
		tr, _ := transport(t, reply(submitted, "application/json", 200), reply(completion, "text/event-stream", 200), &http.Response{StatusCode: 200, Header: http.Header{}, Body: download})
		parent, cancelParent := context.WithCancel(context.Background())
		audio, err := Synthesize(parent, baseRequest(), Options{Auth: authenticated(), Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		next, cancelNext := context.WithCancel(context.Background())
		item, err := audio.Next(next)
		if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte("first")}) {
			t.Fatal(item, err)
		}
		cancelNext()
		if cancelParentAfterRead {
			cancelParent()
			await(t, download.closed)
			if _, err := audio.Next(context.Background()); err != context.Canceled {
				t.Fatal(err)
			}
		} else {
			item, err = audio.Next(context.Background())
			if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte("second")}) {
				t.Fatal(item, err)
			}
		}
		audio.Close()
		cancelParent()
		if download.closes.Load() != 1 {
			t.Fatal(download.closes.Load())
		}
	}
}

func TestReadErrorsFinalBytesAndCompletionOwnership(t *testing.T) {
	original := errors.New("original read")
	for _, stage := range []string{"submit", "queue", "download"} {
		replies := []*http.Response{}
		if stage != "submit" {
			replies = append(replies, reply(submitted, "application/json", 200))
		}
		if stage == "download" {
			replies = append(replies, reply(completion, "text/event-stream", 200))
		}
		active := newBody(step{err: original})
		active.closeError = errors.New("cleanup")
		contentType := "application/octet-stream"
		if stage == "queue" {
			contentType = "text/event-stream"
		}
		replies = append(replies, &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {contentType}}, Body: active})
		tr, _ := transport(t, replies...)
		audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		if item, err := audio.Next(context.Background()); item != nil || err != original {
			t.Fatal(stage, item, err)
		}
		audio.Close()
		if active.closes.Load() != 1 {
			t.Fatal(active.closes.Load())
		}
	}
	for _, terminal := range []error{io.EOF, original} {
		download := newBody(step{data: []byte("first"), err: terminal})
		download.closeError = errors.New("cleanup")
		tr, _ := transport(t, reply(submitted, "application/json", 200), reply(completion, "text/event-stream", 200), &http.Response{StatusCode: 200, Header: http.Header{}, Body: download})
		audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		item, err := audio.Next(context.Background())
		if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte("first")}) {
			t.Fatal(item, err)
		}
		item, err = audio.Next(context.Background())
		if terminal == io.EOF {
			if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsDone{Value: out.DoneEvent{RequestId: "event/?#雪"}}) {
				t.Fatal(item, err)
			}
		} else if err != original || item != nil {
			t.Fatal(item, err)
		}
		if download.closes.Load() != 1 {
			t.Fatal("not closed at terminal event")
		}
		audio.Close()
		if _, err := audio.Next(context.Background()); err != io.EOF {
			t.Fatal(err)
		}
	}
	audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { return nil, original })})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := audio.Next(context.Background()); err != original {
		t.Fatal(err)
	}
	audio.Close()
}

func TestMalformedMetadataFilesAndBodies(t *testing.T) {
	type scenario struct {
		request schema.TtsRequest
		replies []*http.Response
		error   string
	}
	cases := []scenario{}
	for _, value := range []string{`[]`, `[""]`, `[null]`, `["one","two"]`, `{"path":"x"}`} {
		r := baseRequest()
		r.Value.ReferenceAudio = runtime.Some([]byte("audio"))
		cases = append(cases, scenario{r, []*http.Response{reply(value, "application/json", 200)}, "Resemble returned an invalid upload path"})
	}
	for _, value := range []string{`{}`, `{"event_id":""}`, `{"event_id":"."}`, `{"event_id":".."}`, `{"event_id":0}`} {
		cases = append(cases, scenario{baseRequest(), []*http.Response{reply(value, "application/json", 200)}, "Resemble returned an invalid event ID"})
	}
	for _, value := range []string{`{}`, `{"named_endpoints":{}}`, `{"named_endpoints":{"/generate":{"parameters":[]}}}`, `{"named_endpoints":{"/generate":{"parameters":[null,{"parameter_name":"wrong","parameter_default":{"path":"x"}}]}}}`} {
		cases = append(cases, scenario{schema.TtsRequestAsChatterboxTurboText{Value: schema.TtsRequestChatterboxTurboText{Text: "Hello"}}, []*http.Response{reply(value, "application/json", 200)}, "Resemble returned no default reference recording"})
	}
	for _, value := range []string{"{", "NaN", strings.Repeat("[", 11000), "\xff"} {
		cases = append(cases, scenario{baseRequest(), []*http.Response{reply(value, "application/json", 200)}, "Resemble returned invalid JSON"})
	}
	for _, file := range []string{`{"path":""}`, `{"path":1}`, `{"path":"a","url":3}`, `{"path":"a","meta":null}`, `{"path":"a","meta":{"_type":"wrong"}}`, `{"path":"a","is_stream":0}`, `{"path":"a","is_stream":{}}`, `{"path":"a","meta":{"_type":[]}}`} {
		cases = append(cases, scenario{baseRequest(), []*http.Response{reply(submitted, "application/json", 200), reply("event: complete\ndata: ["+file+"]\n\n", "text/event-stream", 200)}, "Resemble returned an invalid audio file"})
	}
	cases = append(cases,
		scenario{baseRequest(), []*http.Response{reply(submitted, "application/json", 200), reply(completion, "application/json", 200)}, "Resemble returned no event stream"},
		scenario{baseRequest(), []*http.Response{reply(submitted, "application/json", 200), reply(completion, "text/event-stream", 200), reply(`{}`, "application/json", 200)}, "Resemble returned no audio stream"},
		scenario{baseRequest(), []*http.Response{reply(submitted, "application/json", 200), reply(completion, "text/event-stream", 200), reply("", "audio/wav", 200)}, "Resemble returned empty audio"},
	)
	for _, tc := range cases {
		tr, calls := transport(t, tc.replies...)
		audio, err := Synthesize(context.Background(), tc.request, Options{Auth: authenticated(), Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		_, failure := collect(t, audio)
		if failure != tc.error || len(*calls) != len(tc.replies) {
			t.Fatal(failure, tc.error, len(*calls))
		}
		for _, response := range tc.replies {
			if response.Body.(*body).closes.Load() != 1 {
				t.Fatal("response leaked")
			}
		}
	}
}

func TestResourceLimitsAndLiveMetadata(t *testing.T) {
	for _, stage := range []string{"submit", "error", "info", "upload"} {
		active := newBody(step{data: []byte("abcd")}, step{data: []byte("efgh")})
		active.stall = true
		request := schema.TtsRequest(baseRequest())
		if stage == "info" {
			request = schema.TtsRequestAsChatterboxTurboText{Value: schema.TtsRequestChatterboxTurboText{Text: "Hello"}}
		}
		if stage == "upload" {
			r := baseRequest()
			r.Value.ReferenceAudio = runtime.Some([]byte("audio"))
			request = r
		}
		status := 200
		if stage == "error" {
			status = 500
		}
		tr, _ := transport(t, &http.Response{StatusCode: status, Header: http.Header{}, Body: active})
		audio, err := Synthesize(context.Background(), request, Options{Auth: authenticated(), Transport: tr, MaxJSONBytes: 7})
		if err != nil {
			t.Fatal(err)
		}
		_, failure := collect(t, audio)
		if failure != "Resemble response exceeds MaxJSONBytes" || active.reads.Load() != 2 || active.closes.Load() != 1 {
			t.Fatal(stage, failure, active.reads.Load(), active.closes.Load())
		}
	}
	queue := newBody(step{data: []byte(":" + strings.Repeat("a", 100))})
	queue.stall = true
	tr, _ := transport(t, reply(submitted, "application/json", 200), &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: queue})
	audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr, MaxEventBytes: 100})
	if err != nil {
		t.Fatal(err)
	}
	_, failure := collect(t, audio)
	if failure != "SSE event exceeds byte limit" || queue.reads.Load() != 1 || queue.closes.Load() != 1 {
		t.Fatal(failure, queue.reads.Load(), queue.closes.Load())
	}
	data, err := os.ReadFile("../../../../schemas/sources/resemble/02-gradio-schema.json")
	if err != nil {
		t.Fatal(err)
	}
	value, err := decode(data)
	if err != nil {
		t.Fatal(err)
	}
	parameter := value.(map[string]any)["named_endpoints"].(map[string]any)["/generate"].(map[string]any)["parameters"].([]any)[1].(map[string]any)
	parameter["parameter_default"].(map[string]any)["path"] = "/new-cache/current.wav"
	data, err = json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var sent any
	tr, _ = transport(t, reply(string(data), "application/json", 200), reply(submitted, "application/json", 200), reply(completion, "text/event-stream", 200), reply("audio", "audio/wav", 200))
	captured := tr
	tr = transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method == "POST" {
			if err := json.NewDecoder(r.Body).Decode(&sent); err != nil {
				return nil, err
			}
		}
		return captured.Do(r)
	})
	audio, err = Synthesize(context.Background(), schema.TtsRequestAsChatterboxTurboText{Value: schema.TtsRequestChatterboxTurboText{Text: "Hello"}}, Options{Auth: authenticated(), Transport: tr})
	if err != nil {
		t.Fatal(err)
	}
	_, failure = collect(t, audio)
	if failure != "" {
		t.Fatal(failure)
	}
	if !reflect.DeepEqual(sent.(map[string]any)["data"].([]any)[1], map[string]any{"path": "/new-cache/current.wav", "meta": map[string]any{"_type": "gradio.FileData"}}) {
		t.Fatal(sent)
	}
}
