package lovo

import (
    "context"
    "encoding/json"
    "io"
    "net/http"
    "reflect"
    "strings"
    "testing"

    "github.com/speechswitch/client/sdks/go/runtime"
)

type transport struct { requests []*http.Request; bodies []string }
func (t *transport) Do(request *http.Request) (*http.Response, error) {
    data, err := io.ReadAll(request.Body)
    if err != nil { return nil, err }
    t.requests = append(t.requests, request)
    t.bodies = append(t.bodies, string(data))
    return &http.Response{StatusCode:202, Body:io.NopCloser(strings.NewReader(""))}, nil
}
func equal(t *testing.T, actual, expected any) {
    t.Helper(); if !reflect.DeepEqual(actual,expected) { t.Fatalf("got %#v, want %#v",actual,expected) }
}
func TestChangedTransportAndConstraints(t *testing.T) {
    equal(t,DefaultBaseURL,"https://changed.invalid/root/?tenant=one")
    equal(t,CreateSpeechStatus,202)
    client := &transport{}
    response, err := GetSpeechJob(context.Background(),GetSpeechJobInput{Id:"a/b?x"},"key",DefaultBaseURL,client)
    if err != nil { t.Fatal(err) }; response.Body.Close()
    r := client.requests[0]
    equal(t,r.Method,"POST"); equal(t,r.URL.String(),"https://changed.invalid/root/new/a%2Fb%3Fx?tenant=one")
    equal(t,r.Header,http.Header{"Changed-Key":{"key"}}); equal(t,client.bodies,[]string{""})
    _, err = GetSpeechJob(context.Background(),GetSpeechJobInput{Id:"x"},"key",DefaultBaseURL,client)
    equal(t,err.Error(),"Invalid LOVO async-retrieve-job request")
    nickname := "😀a"
    valid := CreateSpeechInput{Text:7,Speaker:"v",Enabled:false,Nickname:runtime.Some(&nickname)}
    for _, n := range []float64{4,11,7.5,9007199254740992} {
        invalid := valid; invalid.Text=n
        _, err = CreateSpeech(context.Background(),invalid,"key",DefaultBaseURL,client)
        equal(t,err.Error(),"Invalid LOVO sync-tts request")
    }
    equal(t,len(client.requests),1)
    response, err = CreateSpeech(context.Background(),valid,"key",DefaultBaseURL,client)
    if err != nil { t.Fatal(err) }; response.Body.Close()
    var body map[string]any
    if err := json.Unmarshal([]byte(client.bodies[1]),&body); err != nil { t.Fatal(err) }
    equal(t,body,map[string]any{"text":float64(7),"speaker":"v","enabled":false,"nickname":"😀a"})
    valid.Nickname.Value=nil
    response, err = CreateSpeech(context.Background(),valid,"key",DefaultBaseURL,client)
    if err != nil { t.Fatal(err) }; response.Body.Close()
    if err := json.Unmarshal([]byte(client.bodies[2]),&body); err != nil { t.Fatal(err) }
    equal(t,body,map[string]any{"text":float64(7),"speaker":"v","enabled":false,"nickname":nil})
    valid.Extra=map[string]any{"text":float64(8)}
    _, err = CreateSpeech(context.Background(),valid,"key",DefaultBaseURL,client)
    equal(t,err.Error(),"Invalid LOVO sync-tts request")
}

func TestChangedNestedResponse(t *testing.T) {
    text := `{"id":"job","type":"tts","status":"done","progress":1,"team":"team","createdAt":"now","data":[{"status":"new_status","text":"Hi","speaker":"v","speakerStyle":"s","speed":1,"pause":[],"emphasis":[{"position":0,"value":0.1}],"pronunciations":[],"urls":[1]}]}`
    job, err := DecodeCreateSpeech([]byte(text))
    if err != nil { t.Fatal(err) }
    equal(t,job.Data[0].Emphasis[0].Value,0.1)
    equal(t,job.Data[0].Urls,TextToSpeechOutputUrls{1})
    for _, change := range [][2]string{
        {"new_status","succeeded"}, {`"urls":[1]`,`"urls":["https://audio.invalid"]`},
        {`"urls":[1]`,`"urls":[true]`}, {`"urls":[1]`,`"urls":[1.5]`},
        {`"value":0.1`,`"value":0.25`}, {`,"urls":[1]`,""},
    } {
        _, err := DecodeCreateSpeech([]byte(strings.ReplaceAll(text,change[0],change[1])))
        equal(t,err.Error(),"Invalid LOVO sync-tts response")
    }
}
