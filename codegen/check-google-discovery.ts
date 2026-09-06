import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderGoogleDiscoveryPython } from "./google-discovery-python.ts";
import { renderGoogleDiscoveryGo } from "./google-discovery-go.ts";

const root = path.resolve(import.meta.dirname, "..");
const discovery = JSON.parse(readFileSync(path.join(root, "schemas/sources/google/00-discovery.json"), "utf8"));
discovery.rootUrl = "https://changed.invalid/";
discovery.resources.text.methods.synthesize.path = "v2/speech:render";
discovery.resources.voices.methods.list.path = "v2/catalog";
discovery.resources.voices.methods.list.httpMethod = "POST";
discovery.resources.voices.methods.list.parameters = {
  locale: { type: "string", location: "query", enum: ["en US", "ja JP"], required: true },
  enabled: { type: "boolean", location: "query" },
  limit: { type: "integer", location: "query" },
};
discovery.schemas.AudioConfig.properties.audioEncoding.enum.push("EXPERIMENTAL");
discovery.schemas.SynthesisInput.required = ["text"];
discovery.schemas.SynthesisInput.properties.experimental = { type: "object", properties: {
  enabled: { type: "boolean" }, labels: { type: "object", additionalProperties: { type: "string" } },
  items: { type: "array", items: { type: "object", properties: { counter: { $ref: "Counter" } }, required: ["counter"] } },
  metrics: { $ref: "MetricMap" },
}, required: ["enabled"] };
discovery.schemas.Counter = { type: "integer" };
discovery.schemas.MetricMap = { type: "object", additionalProperties: { type: "number" } };
discovery.schemas.SynthesizeSpeechResponse.properties = { payload: { type: "string" } };
discovery.schemas.SynthesizeSpeechResponse.required = ["payload"];

const temporary = mkdtempSync(path.join(tmpdir(), "google-discovery-python-"));
try {
  writeFileSync(path.join(temporary, "pyrightconfig.json"), JSON.stringify({ pythonVersion: "3.13", typeCheckingMode: "strict", extraPaths: [path.join(root, "sdks/python")], reportUnusedImport: false }));
  writeFileSync(path.join(temporary, "changed.py"), renderGoogleDiscoveryPython(discovery, "https://source.invalid/discovery"));
  writeFileSync(path.join(temporary, "valid.py"), `import asyncio
import json
from types import MappingProxyType
from changed import DEFAULT_BASE_URL, ListVoicesInput, SynthesisInput, synthesize_speech, list_voices, decode_synthesize_speech_response
from speechswitch.http import HttpRequest, HttpResponse
from typing import cast

class Body:
    def __init__(self) -> None:
        self.read = False
    def __aiter__(self):
        return self
    async def __anext__(self) -> bytes:
        self.read = True
        raise AssertionError("Generated client buffered response")
    async def aclose(self) -> None:
        pass

class Transport:
    def __init__(self) -> None:
        self.calls: list[HttpRequest] = []
        self.body = Body()
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.calls.append(request)
        return HttpResponse(200, {}, self.body)

async def main() -> None:
    transport = Transport()
    value: SynthesisInput = {"text": "hello", "experimental": {"enabled": False, "labels": MappingProxyType({"key": "value"}), "items": ({"counter": 0},), "metrics": MappingProxyType({"pitch": 1.25})}}
    await synthesize_speech({"input": value, "audioConfig": {"audioEncoding": "EXPERIMENTAL"}}, base_url="https://proxy.invalid/g/?tenant=one", headers={"authorization": "Bearer test"}, transport=transport)
    await list_voices({"locale": "en US", "enabled": False, "limit": 0}, base_url="https://proxy.invalid/g/?tenant=one", headers={}, transport=transport)
    assert DEFAULT_BASE_URL == "https://changed.invalid/"
    assert [(call.method, call.url, dict(call.headers)) for call in transport.calls] == [
        ("POST", "https://proxy.invalid/g/v2/speech:render?tenant=one", {"authorization": "Bearer test", "content-type": "application/json"}),
        ("POST", "https://proxy.invalid/g/v2/catalog?tenant=one&enabled=false&limit=0&locale=en+US", {}),
    ]
    assert json.loads(transport.calls[0].body) == {"input": {"text": "hello", "experimental": {"enabled": False, "labels": {"key": "value"}, "items": [{"counter": 0}], "metrics": {"pitch": 1.25}}}, "audioConfig": {"audioEncoding": "EXPERIMENTAL"}}
    assert transport.calls[1].body == b""
    assert not transport.body.read
    assert decode_synthesize_speech_response(b'{"payload":"AP8="}') == {"payload": "AP8="}
    try:
        decode_synthesize_speech_response(b'{"audioContent":"AP8="}')
    except TypeError as error:
        assert str(error) == "Invalid Google synthesizeSpeech response"
    else:
        raise AssertionError("Missing new response field was accepted")
    invalids: list[object] = [{}, {"text": "hello", "experimental": {}}, {"text": "hello", "experimental": {"enabled": False, "items": [{"counter": True}]}}]
    for invalid in invalids:
        try:
            await synthesize_speech({"input": cast(SynthesisInput, invalid)}, base_url=DEFAULT_BASE_URL, headers={}, transport=transport)
        except TypeError as error:
            assert str(error) == "Invalid Google synthesizeSpeech input"
        else:
            raise AssertionError("Invalid new request shape was accepted")
    assert len(transport.calls) == 2
    invalid_queries: list[object] = [{}, {"locale": "bad"}, {"locale": "en US", "enabled": "false"}, {"locale": "en US", "limit": 0.5}]
    for invalid in invalid_queries:
        try:
            await list_voices(cast(ListVoicesInput, invalid), base_url=DEFAULT_BASE_URL, headers={}, transport=transport)
        except TypeError as error:
            assert str(error) == "Invalid Google listVoices input"
        else:
            raise AssertionError("Invalid query was accepted")
    assert len(transport.calls) == 2

asyncio.run(main())
`);
  writeFileSync(path.join(temporary, "invalid.py"), `from changed import SynthesisInput, ListVoicesInput, SynthesizeSpeechResponse
missing_text: SynthesisInput = {}
missing_enabled: SynthesisInput = {"text": "hello", "experimental": {}}
missing_locale: ListVoicesInput = {}
bad_counter: SynthesisInput = {"text": "hello", "experimental": {"enabled": False, "items": [{"counter": 0.5}]}}
missing_payload: SynthesizeSpeechResponse = {"audioContent": "AP8="}
`);
  const env = { ...process.env, PYTHONPATH: [path.join(root, "sdks/python"), temporary].join(path.delimiter) };
  const execute = spawnSync("python3", [path.join(temporary, "valid.py")], { env, encoding: "utf8" });
  assert.equal(execute.status, 0, execute.stdout + execute.stderr);
  const types = spawnSync("pyright", ["--project", temporary, path.join(temporary, "changed.py"), path.join(temporary, "valid.py")], { cwd: temporary, env, encoding: "utf8" });
  assert.equal(types.status, 0, types.stdout + types.stderr);
  const invalid = spawnSync("pyright", ["--outputjson", "--project", temporary, path.join(temporary, "invalid.py")], { cwd: temporary, env, encoding: "utf8" });
  assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
  assert.deepEqual(JSON.parse(invalid.stdout).generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
    [2, 3, 4, 5, 6].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));
} finally { rmSync(temporary, { recursive: true, force: true }); }
const goTemporary = mkdtempSync(path.join(tmpdir(), "google-discovery-go-"));
try {
  writeFileSync(path.join(goTemporary, "client.go"), renderGoogleDiscoveryGo(discovery, "https://source.invalid/discovery", "changed"));
  writeFileSync(path.join(goTemporary, "client_test.go"), `package changed
import ("context"; "encoding/json"; "errors"; "io"; "math"; "math/big"; "net/http"; "reflect"; "testing"; "github.com/speechswitch/client/sdks/go/runtime")
type body struct { reads int }
func (b *body) Read([]byte) (int, error) { b.reads++; return 0, errors.New("buffered response") }
func (*body) Close() error { return nil }
type transport struct { calls []*http.Request; body *body }
func (t *transport) Do(r *http.Request) (*http.Response, error) { t.calls = append(t.calls, r); return &http.Response{StatusCode: 429, Body: t.body}, nil }
func TestChanged(t *testing.T) {
  transport := &transport{body: &body{}}
  options := ClientOptions{BaseURL: "https://proxy.invalid/g/?tenant=one", Headers: http.Header{"Authorization": {"Bearer test"}}, Transport: transport}
  input := SynthesisInput{Text: "hello", Experimental: runtime.Some(SynthesisInputExperimental{
    Enabled: false, Labels: runtime.Some(map[string]string{"key": "value"}),
    Items: runtime.Some([]SynthesisInputExperimentalItemsItem{{Counter: big.NewInt(0)}}), Metrics: runtime.Some(map[string]float64{"pitch": 1.25}),
  })}
  response, err := SynthesizeSpeech(context.Background(), SynthesizeSpeechRequest{Input: runtime.Some(input), AudioConfig: runtime.Some(AudioConfig{AudioEncoding: runtime.Some(AudioConfigAudioEncoding(AudioConfigAudioEncodingEXPERIMENTAL{}))})}, options)
  if err != nil || response.Body != transport.body || transport.body.reads != 0 { t.Fatalf("response ownership: %v %v", response, err) }
  _, err = ListVoices(context.Background(), ListVoicesInput{Locale: ListVoicesInputLocaleEnUS{}, Enabled: runtime.Some(false), Limit: runtime.Some(big.NewInt(0))}, options)
  if err != nil { t.Fatal(err) }
  if DefaultBaseURL != "https://changed.invalid/" { t.Fatal(DefaultBaseURL) }
  expectedURLs := []string{"https://proxy.invalid/g/v2/speech:render?tenant=one", "https://proxy.invalid/g/v2/catalog?enabled=false&limit=0&locale=en+US&tenant=one"}
  for index, call := range transport.calls { if call.Method != "POST" || call.URL.String() != expectedURLs[index] { t.Fatalf("operation: %s %s", call.Method, call.URL) } }
  data, err := io.ReadAll(transport.calls[0].Body); if err != nil { t.Fatal(err) }
  if string(data) != ${JSON.stringify('{"audioConfig":{"audioEncoding":"EXPERIMENTAL"},"input":{"experimental":{"enabled":false,"items":[{"counter":0}],"labels":{"key":"value"},"metrics":{"pitch":1.25}},"text":"hello"}}')} { t.Fatalf("body: %s", data) }
  if !reflect.DeepEqual(transport.calls[0].Header, http.Header{"Authorization": {"Bearer test"}, "Content-Type": {"application/json"}}) || !reflect.DeepEqual(transport.calls[1].Header, options.Headers) || transport.calls[1].ContentLength != 0 { t.Fatal("changed headers/body ownership") }
  decoded, err := DecodeSynthesizeSpeechResponse([]byte(${JSON.stringify('{"payload":"AP8="}')})); if err != nil || decoded.Payload != "AP8=" { t.Fatalf("response: %v %v", decoded, err) }
  _, err = DecodeSynthesizeSpeechResponse([]byte(${JSON.stringify('{"audioContent":"AP8="}')})); if err == nil || err.Error() != "Invalid Google synthesizeSpeech response" { t.Fatalf("missing required response field: %v", err) }
  for _, experimental := range []SynthesisInputExperimental{
    {Items: runtime.Some([]SynthesisInputExperimentalItemsItem{{Counter: nil}})}, {Metrics: runtime.Some(map[string]float64{"pitch": math.NaN()})},
  } { _, err = SynthesizeSpeech(context.Background(), SynthesizeSpeechRequest{Input: runtime.Some(SynthesisInput{Text: "hello", Experimental: runtime.Some(experimental)})}, options); if err == nil || err.Error() != "Invalid Google synthesizeSpeech input" { t.Fatalf("invalid added field: %v", err) } }
  _, err = ListVoices(context.Background(), ListVoicesInput{}, options); if err == nil || err.Error() != "Invalid Google listVoices input" { t.Fatalf("missing required enum: %v", err) }
  if len(transport.calls) != 2 { t.Fatal("invalid input reached transport") }
  huge := "1606938044258990275541962092341162602522202993782792835301376"
  number, err := decodeCounter(json.Number(huge)); if err != nil || number.String() != huge { t.Fatalf("integer precision: %v %v", number, err) }
  encoded, err := encodeCounter(number); if err != nil || encoded != json.Number(huge) { t.Fatalf("integer output: %v %v", encoded, err) }
}
`);
  const result = spawnSync("go", ["test", path.join(goTemporary, "client.go"), path.join(goTemporary, "client_test.go")], { cwd: path.join(root, "sdks/go"), encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const emptyQuery = structuredClone(discovery);
  emptyQuery.resources.voices.methods.list.parameters = {};
  writeFileSync(path.join(goTemporary, "empty.go"), renderGoogleDiscoveryGo(emptyQuery, "https://source.invalid/discovery", "empty"));
  const empty = spawnSync("go", ["test", path.join(goTemporary, "empty.go")], { cwd: path.join(root, "sdks/go"), encoding: "utf8" });
  assert.equal(empty.status, 0, empty.stdout + empty.stderr);
} finally { rmSync(goTemporary, { recursive: true, force: true }); }
console.log("Google Discovery mutations change executed Python/Go HTTP operations, field validation, response decoding and compiler-visible types.");
