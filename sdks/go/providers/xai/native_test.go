package xai

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/xai"
	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func readFrame(reader *bufio.Reader) (byte, []byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return 0, nil, err
	}
	if header[0]&128 == 0 || header[1]&128 == 0 {
		return 0, nil, fmt.Errorf("unmasked or fragmented client frame")
	}
	size := uint64(header[1] & 127)
	if size == 126 {
		var b [2]byte
		if _, err := io.ReadFull(reader, b[:]); err != nil {
			return 0, nil, err
		}
		size = uint64(binary.BigEndian.Uint16(b[:]))
	} else if size == 127 {
		var b [8]byte
		if _, err := io.ReadFull(reader, b[:]); err != nil {
			return 0, nil, err
		}
		size = binary.BigEndian.Uint64(b[:])
	}
	if size > 4096 {
		return 0, nil, fmt.Errorf("oversized fixture frame")
	}
	var mask [4]byte
	if _, err := io.ReadFull(reader, mask[:]); err != nil {
		return 0, nil, err
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return 0, nil, err
	}
	for i := range data {
		data[i] ^= mask[i%4]
	}
	return header[0] & 15, data, nil
}

func TestNativeAuthQueryAndFragmentedCharacterTiming(t *testing.T) {
	done := make(chan error, 1)
	handshakes := make(chan *http.Request, 1)
	messages := make(chan map[string]any, 3)
	expires, _ := deadline(t).Deadline()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		done <- func() error {
			handshakes <- r.Clone(context.Background())
			conn, rw, err := w.(http.Hijacker).Hijack()
			if err != nil {
				return err
			}
			defer conn.Close()
			if err := conn.SetDeadline(expires); err != nil {
				return err
			}
			digest := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
			if _, err := fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(digest[:])); err != nil {
				return err
			}
			if err := rw.Flush(); err != nil {
				return err
			}
			for i := 0; i < 3; i++ {
				kind, data, err := readFrame(rw.Reader)
				if err != nil {
					return err
				}
				if kind != 1 {
					return fmt.Errorf("expected text, got %d", kind)
				}
				var m map[string]any
				if err := json.Unmarshal(data, &m); err != nil {
					return err
				}
				messages <- m
			}
			frames := []string{`{"type":"session.updated","replace":{"Acme Mobile":"native"}}`, `{"type":"audio.delta","delta":"AP+A","audio_duration":0.25,"audio_timestamps":{"graph_chars":["😀"],"graph_times":[[0,0.25]]}}`, `{"type":"audio.done","trace_id":"native"}`}
			for _, message := range frames {
				data := []byte(message)
				for i, b := range data {
					opcode := byte(0)
					if i == 0 {
						opcode = 1
					} else if i == len(data)-1 {
						opcode = 128
					}
					if _, err := rw.Write([]byte{opcode, 1, b}); err != nil {
						return err
					}
				}
				if err := rw.Flush(); err != nil {
					return err
				}
			}
			kind, _, err := readFrame(rw.Reader)
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return err
			}
			if kind != 8 {
				return fmt.Errorf("expected close, got %d", kind)
			}
			return nil
		}()
	}))
	defer server.Close()
	p := newProducer()
	p.values <- sourceResult{item: schema.TtsRequestStreamingTextTextItemAsString{Value: "Acme"}}
	p.values <- sourceResult{err: io.EOF}
	r := liveRequest(p)
	v := requests()[1].Value
	r.Value.Voice, r.Value.Output, r.Value.LatencyOptimization, r.Value.TextNormalization, r.Value.Replacements = v.Voice, v.Output, v.LatencyOptimization, v.TextNormalization, v.Replacements
	r.Value.Speed = runtime.Some(1.0)
	r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextTimestampGranularity{})
	input, err := Synthesize(deadline(t), r, Options{Auth: authenticated(), BaseURL: server.URL + "/proxy%2Fpath?tenant=a%2Bb&language=fr&voice=wrong"})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	got, err := collect(deadline(t), input)
	if err != nil {
		t.Fatal(err)
	}
	req := <-handshakes
	equal(t, req.URL.EscapedPath(), "/proxy%2Fpath/v1/tts")
	equal(t, req.Header.Get("Authorization"), "Bearer fixture")
	equal(t, req.Header.Get("Sec-WebSocket-Protocol"), "")
	equal(t, req.URL.Query(), url.Values{"tenant": {"a+b"}, "language": {"auto"}, "voice": {"existing-custom-voice"}, "codec": {"mp3"}, "sample_rate": {"24000"}, "bit_rate": {"128000"}, "speed": {"1"}, "optimize_streaming_latency": {"2"}, "text_normalization": {"false"}, "with_timestamps": {"true"}})
	equal(t, <-messages, map[string]any{"type": "session.update", "replace": map[string]any{"Acme Mobile": "Acme Mobull"}})
	equal(t, <-messages, map[string]any{"type": "text.delta", "delta": "Acme"})
	equal(t, <-messages, map[string]any{"type": "text.done"})
	equal(t, got, []out.SynthesisItem{
		out.SynthesisItemAsUpdated{Value: out.UpdatedEvent{Replacements: []out.UpdatedEventReplacementsItem{{Pattern: "Acme Mobile", Replacement: "native"}}}},
		out.SynthesisItemAsChunk{Value: out.TimestampedAudio{Audio: []byte{0, 255, 128}, DurationMs: runtime.Some(250.0), Timestamps: []out.CharacterTimestamp{{Value: "😀", StartTimeMs: 0, EndTimeMs: 250}}}},
		out.SynthesisItemAsDone{Value: out.DoneEvent{TraceId: runtime.Some("native")}},
	})
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestNativeHTTPYieldsBeforeEOFAndConsumerExitDisconnects(t *testing.T) {
	closed := make(chan struct{})
	requests := make(chan *http.Request, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Clone(context.Background())
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Write([]byte{0, 255})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), BaseURL: server.URL + "/proxy%2Fraw/"})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	item, err := input.Next(deadline(t))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
	req := <-requests
	equal(t, req.URL.RequestURI(), "/proxy%2Fraw/v1/tts")
	equal(t, req.Header.Get("Authorization"), "Bearer fixture")
	equal(t, req.Header.Get("Accept"), "audio/*, application/octet-stream")
	select {
	case <-closed:
		t.Fatal("closed before consumer exit")
	default:
	}
	input.Close()
	await(t, closed)
}

func TestNativeRedirectsAndUpgradeRejectionNeverAcquireInput(t *testing.T) {
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	equal(t, err, &Error{Status: runtime.Some(307)})
	equal(t, redirected.Load(), int32(0))
	p := newProducer()
	input, err = Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocketURL: server.URL + "/v1/tts"})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	if err == nil {
		t.Fatal("accepted rejected upgrade")
	}
	equal(t, err.Error(), "WebSocket handshake was not accepted")
	equal(t, p.reads.Load(), int32(0))
	equal(t, p.closes.Load(), int32(0))
	equal(t, redirected.Load(), int32(0))
}
