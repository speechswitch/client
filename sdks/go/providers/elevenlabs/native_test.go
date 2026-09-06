package elevenlabs

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/elevenlabs"
	out "github.com/speechswitch/client/sdks/go/generated/elevenlabs_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func clientFrame(reader io.Reader) (map[string]any, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	if header[0] != 0x81 || header[1]&128 == 0 {
		return nil, errors.New("invalid client text frame")
	}
	size := int(header[1] & 127)
	if size == 127 {
		return nil, errors.New("unexpected large fixture frame")
	}
	if size == 126 {
		var extended [2]byte
		if _, err := io.ReadFull(reader, extended[:]); err != nil {
			return nil, err
		}
		size = int(binary.BigEndian.Uint16(extended[:]))
	}
	var mask [4]byte
	if _, err := io.ReadFull(reader, mask[:]); err != nil {
		return nil, err
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}
	for i := range data {
		data[i] ^= mask[i%4]
	}
	var value map[string]any
	err := json.Unmarshal(data, &value)
	return value, err
}
func TestNativeSocketAuthQueriesAndMaskedFrames(t *testing.T) {
	for _, v3 := range []bool{false, true} {
		for _, token := range []bool{false, true} {
			finished := make(chan error, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				finished <- func() error {
					model, path := "eleven_flash_v2_5", "/p%20x/v1/text-to-speech/custom%2Fid/multi-stream-input"
					if v3 {
						model, path = "eleven_v3", "/p%20x/v1/text-to-dialogue/stream-input"
					}
					query := url.Values{"trace": {"1"}, "model_id": {model}, "output_format": {"pcm_24000"}, "sync_alignment": {"false"}, "enable_logging": {"false"}, "apply_text_normalization": {"off"}, "language_code": {"ja"}, "seed": {"4294967295"}}
					key := "test-key"
					if token {
						query.Set("single_use_token", "short+token")
						key = ""
						path = "/override"
					}
					if !v3 {
						query.Set("auto_mode", "true")
						query.Set("enable_ssml_parsing", "true")
						query.Set("inactivity_timeout", "20")
					}
					if r.URL.EscapedPath() != path || !reflect.DeepEqual(r.URL.Query(), query) || r.Header.Get("xi-api-key") != key {
						return fmt.Errorf("unexpected upgrade %s", r.URL)
					}
					conn, buffer, err := w.(http.Hijacker).Hijack()
					if err != nil {
						return err
					}
					defer conn.Close()
					conn.SetDeadline(time.Now().Add(3 * time.Second))
					hash := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
					fmt.Fprintf(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(hash[:]))
					if err := buffer.Flush(); err != nil {
						return err
					}
					initial, err := clientFrame(buffer)
					if err != nil {
						return err
					}
					id := initial["context_id"]
					voice := map[string]any{"stability": float64(0)}
					expected := map[string]any{"voice_settings": voice, "pronunciation_dictionary_locators": []any{map[string]any{"pronunciation_dictionary_id": "lex", "version_id": "version"}}}
					if v3 {
						expected["voices"] = []any{"custom/id"}
					} else {
						expected["text"], expected["context_id"] = " ", id
						voice["similarity_boost"], voice["style"], voice["speed"], voice["use_speaker_boost"] = float64(0), float64(0), 0.7, false
					}
					if !reflect.DeepEqual(initial, expected) {
						return fmt.Errorf("unexpected initial payload %#v", initial)
					}
					message, err := clientFrame(buffer)
					if err != nil {
						return err
					}
					expected = map[string]any{"context_id": id, "text": "hi"}
					if v3 {
						expected = map[string]any{"inputs": []any{map[string]any{"text": "hi", "voice_id": "custom/id"}}}
					}
					if !reflect.DeepEqual(message, expected) {
						return fmt.Errorf("unexpected text %#v", message)
					}
					if !v3 {
						message, err = clientFrame(buffer)
						if err != nil {
							return err
						}
						if !reflect.DeepEqual(message, map[string]any{"context_id": id, "text": " ", "flush": true}) {
							return fmt.Errorf("unexpected flush %#v", message)
						}
					}
					message, err = clientFrame(buffer)
					if err != nil {
						return err
					}
					if !reflect.DeepEqual(message, map[string]any{"close_socket": true}) {
						return fmt.Errorf("unexpected close %#v", message)
					}
					final, _ := json.Marshal(map[string]any{"context_id": id, "audio": "AQ==", "is_final": true})
					if len(final) >= 126 {
						return errors.New("fixture too large")
					}
					buffer.Write([]byte{0x81, byte(len(final))})
					buffer.Write(final)
					if err = buffer.Flush(); err != nil {
						return err
					}
					_, err = io.Copy(io.Discard, buffer)
					return err
				}()
			}))
			src, v3src := newSource(text("hi")), newSource(dialogueText("hi"))
			var normalization schema.TtsRequestTextVoice4a0120aeTextNormalization = schema.TtsRequestTextVoice4a0120aeTextNormalizationAsFalse{}
			var boost schema.TtsRequestTextVoice4a0120aeLanguageTextNormalization = schema.TtsRequestTextVoice4a0120aeLanguageTextNormalizationAsFalse{}
			var inputType schema.TtsRequestStreamingTextVoice194990a6InputType = schema.TtsRequestStreamingTextVoice194990a6InputTypeAsSsml{}
			output := schema.TtsRequestStreamingTextVoice194990a6OutputAsPcm{Value: schema.TtsRequestTextVoice4a0120aeOutputPcm{SampleRateHz: schema.TtsRequestTextVoice4a0120aeOutputPcmSampleRateHzAsNumber24000{}}}
			dictionaries := runtime.Some([]schema.TtsRequestStreamingTextVoice194990a6PronunciationDictionariesItem{{Id: "lex", VersionId: "version"}})
			var r schema.TtsRequest = schema.TtsRequestAsStreamingTextVoicef49cfea8{Value: schema.TtsRequestStreamingTextVoicef49cfea8{Model: request().Value.Model, Voice: "custom/id", Text: src, Output: output, Language: runtime.Some("ja"), RandomSeed: runtime.Some(4294967295.0), TextNormalization: runtime.Some(normalization), Stability: runtime.Some(0.0), VoiceSimilarity: runtime.Some(0.0), StyleExaggeration: runtime.Some(0.0), Speed: runtime.Some(0.7), VoiceBoost: runtime.Some(boost), InputType: runtime.Some(inputType), PronunciationDictionaries: dictionaries}}
			if v3 {
				r = schema.TtsRequestAsElevenV3StreamingTextVoicef18e078f{Value: schema.TtsRequestElevenV3StreamingTextVoicef18e078f{Voice: "custom/id", Text: v3src, Output: output, Language: runtime.Some("ja"), RandomSeed: runtime.Some(4294967295.0), TextNormalization: runtime.Some(normalization), Stability: runtime.Some(0.0), PronunciationDictionaries: dictionaries}}
			}
			options := Options{Auth: testAuth, BaseURL: server.URL + "/p%20x?trace=1&seed=2&api_key=stale", RequestLogging: runtime.Some(false)}
			if token {
				options.Auth.Elevenlabs.Value.SingleUseToken = runtime.Some("short+token")
				options.WebSocketURL = server.URL + "/override?trace=1&api_key=stale"
			}
			s, err := Synthesize(testContext(t), r, options)
			if err != nil {
				server.Close()
				t.Fatal(err)
			}
			values, err := collect(testContext(t), s)
			s.Close()
			server.Close()
			if err != nil {
				t.Fatal(err)
			}
			equal(t, values, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{1}}})
			if err := <-finished; err != nil {
				t.Fatal(err)
			}
		}
	}
}
func TestNativeHTTPFirstBytesAndIdleCancellation(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() != "/prefix%2Fpath/v1/text-to-speech/custom%2Fid/stream" || r.Header.Get("xi-api-key") != "test-key" {
			t.Error("unexpected HTTP request")
		}
		io.Copy(io.Discard, r.Body)
		w.Header().Set("content-type", "audio/mpeg")
		w.Write([]byte{0, 255})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(testContext(t))
	defer cancel()
	s, err := Synthesize(ctx, request(), Options{Auth: testAuth, BaseURL: server.URL + "/prefix%2Fpath"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	value, err := s.Next(testContext(t))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, value, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
	cancel()
	wait(t, disconnected)
	_, err = s.Next(testContext(t))
	equal(t, err, context.Canceled)
}
func TestNativePendingSetupAndRedirectSafety(t *testing.T) {
	var forwarded atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { forwarded.Add(1) }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer origin.Close()
	_, err := Synthesize(testContext(t), request(), Options{Auth: testAuth, BaseURL: origin.URL})
	var failure *Error
	if !errors.As(err, &failure) {
		t.Fatal(err)
	}
	equal(t, failure.StatusCode, float64(302))
	equal(t, forwarded.Load(), int32(0))
	for _, socket := range []bool{false, true} {
		entered, closed := make(chan struct{}), make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			io.Copy(io.Discard, r.Body)
			close(entered)
			<-r.Context().Done()
			close(closed)
		}))
		ctx, cancel := context.WithCancel(testContext(t))
		done := make(chan error, 1)
		src := newSource(text("unread"))
		go func() {
			var r schema.TtsRequest = request()
			if socket {
				r = live(src)
			}
			_, err := Synthesize(ctx, r, Options{Auth: testAuth, BaseURL: server.URL})
			done <- err
		}()
		wait(t, entered)
		cancel()
		wait(t, closed)
		err := <-done
		server.Close()
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		equal(t, src.pulls.Load(), int32(0))
		equal(t, src.closes.Load(), int32(0))
	}
}
func TestAuthBoundaryPrecedenceAndInvalidOptions(t *testing.T) {
	t.Setenv("SPEECHSWITCH_ELEVENLABS_API_KEY", "")
	t.Setenv("ELEVENLABS_API_KEY", "native")
	if err := os.Unsetenv("SPEECHSWITCH_ELEVENLABS_API_KEY"); err != nil {
		t.Fatal(err)
	}
	scoped, empty := "scoped", ""
	for _, tc := range []struct {
		scoped *string
		auth   auth.Auth
		key    string
	}{
		{nil, auth.Auth{}, "native"}, {&scoped, auth.Auth{}, "scoped"}, {&scoped, testAuth, "test-key"}, {&empty, auth.Auth{}, ""}, {&scoped, auth.Auth{Elevenlabs: runtime.Some(auth.AuthElevenlabs{ApiKey: runtime.Some("")})}, ""},
	} {
		if tc.scoped != nil {
			t.Setenv("SPEECHSWITCH_ELEVENLABS_API_KEY", *tc.scoped)
		}
		calls := 0
		b := &body{}
		s, err := Synthesize(testContext(t), request(), Options{Auth: tc.auth, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
			calls++
			equal(t, r.Header.Get("xi-api-key"), tc.key)
			return &http.Response{StatusCode: 200, Body: b}, nil
		})})
		if tc.key == "" {
			if err == nil {
				t.Fatal("empty key accepted")
			}
			equal(t, err.Error(), "Missing auth.elevenlabs.apiKey configuration")
			equal(t, calls, 0)
		} else {
			if err != nil {
				t.Fatal(err)
			}
			s.Close()
			equal(t, calls, 1)
		}
	}
	for _, options := range []Options{{Auth: testAuth, MaxJSONBytes: -1}, {Auth: testAuth, MaxMessageBytes: -1}} {
		_, err := Synthesize(testContext(t), request(), options)
		if err == nil {
			t.Fatal("negative limit accepted")
		}
		equal(t, err.Error(), "ElevenLabs byte limits must be positive")
	}
	var invalid *schema.TtsRequestAsTextVoice4a0120ae
	_, err := Synthesize(testContext(t), invalid, Options{Auth: testAuth})
	equal(t, err.Error(), "Invalid elevenlabs TTS request")
	options := Options{Auth: auth.Auth{Elevenlabs: runtime.Some(auth.AuthElevenlabs{ApiKey: runtime.Some("key"), SingleUseToken: runtime.Some("")})}, WebSocket: newSocket()}
	_, err = Synthesize(testContext(t), live(newSource(text("hi"))), options)
	equal(t, err.Error(), "Missing auth.elevenlabs.apiKey or singleUseToken configuration")
}
