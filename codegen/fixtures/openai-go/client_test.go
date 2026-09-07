package openai

import (
    "context"
    "encoding/json"
    "io"
    "math"
    "net/http"
    "reflect"
    "strings"
    "testing"
    "github.com/speechswitch/client/sdks/go/runtime"
)

type transportFunc func(*http.Request) (*http.Response, error)
func (f transportFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

func TestChangedContract(t *testing.T) {
    if DefaultBaseURL != "https://changed.invalid/root" || SpeechStatus != 201 { t.Fatal(DefaultBaseURL, SpeechStatus) }
    calls := 0
    transport := transportFunc(func(r *http.Request) (*http.Response, error) {
        calls++
        if r.Method != "POST" || r.URL.String() != "https://changed.invalid/root/changed/speech?tenant=one" { t.Fatal(r.Method, r.URL) }
        expected := http.Header{"Authorization": {"Bearer test"}, "Content-Type": {"application/json"}, "Accept": {"application/octet-stream, text/event-stream"}}
        if !reflect.DeepEqual(r.Header, expected) { t.Fatal(r.Header) }
        data, err := io.ReadAll(r.Body); if err != nil { t.Fatal(err) }
        var payload any; if err := json.Unmarshal(data, &payload); err != nil { t.Fatal(err) }
        expectedPayload := map[string]any{"model": "tts-1", "input": "😀😀", "voice": map[string]any{"id": "saved"}, "enabled": false, "fraction": .25}
        if !reflect.DeepEqual(payload, expectedPayload) { t.Fatal(payload) }
        return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader("audio"))}, nil
    })
    input := SpeechRequest{Input: "😀😀", Model: CreateSpeechRequestModelAsVariant0{Value: "tts-1"},
        Voice: VoiceIdsOrCustomVoiceAsVariant1{Value: VoiceIdsOrCustomVoiceVariant1{Id: "saved"}}, Enabled: false, Fraction: runtime.Some(.25)}
    response, err := CreateSpeech(context.Background(), input, "test", DefaultBaseURL + "/?tenant=one", transport)
    if err != nil { t.Fatal(err) }; response.Body.Close()
    for _, mutate := range []func(*SpeechRequest){
        func(v *SpeechRequest) { v.Input = "abc" },
        func(v *SpeechRequest) { v.Model = nil },
        func(v *SpeechRequest) { v.Model = (*CreateSpeechRequestModelAsVariant0)(nil) },
        func(v *SpeechRequest) { v.Voice = VoiceIdsOrCustomVoiceAsVariant0{} },
        func(v *SpeechRequest) { v.Fraction = runtime.Some(.5) },
        func(v *SpeechRequest) { v.Speed = runtime.Some(math.NaN()) },
        func(v *SpeechRequest) { v.Speed = runtime.Some(.1) },
    } {
        invalid := input; mutate(&invalid)
        _, err := CreateSpeech(context.Background(), invalid, "test", DefaultBaseURL, transport)
        if err == nil || err.Error() != "Invalid OpenAI speech wire request" { t.Fatal(err) }
    }
    if calls != 1 { t.Fatal(calls) }
    valid := []byte(`{"type":"speech.completed","usage":{"input_tokens":"0","output_tokens":1,"total_tokens":1},"future":true}`)
    event, err := DecodeSpeechEvent(valid)
    if err != nil { t.Fatal(err) }
    expectedEvent := CreateSpeechResponseStreamEventAsVariant1{Value: SpeechAudioDoneEvent{Type: "speech.completed", Usage: SpeechAudioDoneEventUsage{InputTokens: "0", OutputTokens: 1, TotalTokens: 1}, Extra: map[string]any{"future": true}}}
    if !reflect.DeepEqual(event, expectedEvent) { t.Fatal(event) }
    for _, data := range []string{
        `{"type":"speech.audio.done","usage":{"input_tokens":"0","output_tokens":1,"total_tokens":1}}`,
        `{"type":"speech.completed","usage":{"input_tokens":0,"output_tokens":1,"total_tokens":1}}`,
        `{"type":"speech.completed","usage":{"input_tokens":"","output_tokens":1,"total_tokens":1}}`,
    } {
        if _, err := DecodeSpeechEvent([]byte(data)); err == nil || err.Error() != "Invalid OpenAI speech event" { t.Fatal(err) }
    }
}
