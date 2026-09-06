import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import protobuf from "protobufjs";
import { renderGoogleProtobufPython } from "./google-protobuf-python.ts";
import { renderGoogleProtobufGo } from "./google-protobuf-go.ts";
import { pascal } from "./language-types.ts";
import { parseGoogleProtobuf, type ProtoSource } from "./google-protobuf.ts";
import { encodeStreamingRequest } from "../sdk/generated/clients/google-grpc.ts";

const root = path.resolve(import.meta.dirname, "..");
const imports = path.join(root, "schemas/sources/google/imports");
const sources = [
  { name: "google/cloud/texttospeech/v1/cloud_tts.proto", text: readFileSync(path.join(root, "schemas/sources/google/02-cloud-tts-v1.proto"), "utf8") },
  ...readdirSync(imports, { recursive: true }).filter(name => typeof name === "string" && name.endsWith(".proto")).map(name => ({ name: String(name), text: readFileSync(path.join(imports, String(name)), "utf8") })),
];
const service = "google.cloud.texttospeech.v1.TextToSpeech";
const parsed = new protobuf.Root(); for (const source of sources) protobuf.parse(source.text, parsed); parsed.resolveAll();
const request = parsed.lookupType("google.cloud.texttospeech.v1.StreamingSynthesizeRequest");
const fixtures = JSON.parse(readFileSync(path.join(root, "sdks/fixtures/google-protobuf.json"), "utf8"));
for (const fixture of fixtures) {
  const expected = Buffer.from(fixture.hex, "hex");
  assert.deepEqual(Buffer.from(request.encode(request.fromObject(fixture.request)).finish()), expected);
  assert.deepEqual(Buffer.from(encodeStreamingRequest(fixture.request)), expected);
}

const changed = sources.map(source => ({ ...source, text: source.name.endsWith("cloud_tts.proto") ? source.text
  .replace("StreamingSynthesisInput input = 2;", "StreamingSynthesisInput input = 9;")
  .replace("PCM = 7;", "PCM = 19;")
  .replaceAll("bytes audio_content = 1;", "bytes audio_content = 11;")
  .replaceAll("optional string prompt = 6;", "optional string prompt = 6; optional bool experimental = 99;") : source.text }));
const temporary = mkdtempSync(path.join(tmpdir(), "google-protobuf-python-"));
try {
  writeFileSync(path.join(temporary, "changed.py"), renderGoogleProtobufPython(changed, service, "StreamingSynthesize"));
  const env = { ...process.env, PYTHONPATH: [path.join(root, "sdks/python"), temporary].join(path.delimiter) };
  const execute = spawnSync("python3", ["-c", `from changed import *
assert encode_streaming_request({"input": {"text": "hi"}}).hex() == "4a040a026869"
assert encode_streaming_audio_config({"audio_encoding": "PCM"}).hex() == "0813"
assert encode_streaming_synthesis_input({"experimental": False}).hex() == "980600"
assert decode_streaming_response(bytes.fromhex("5a020102")) == {"audio_content": bytes([1, 2])}
assert decode_streaming_response(bytes.fromhex("0a020102")) == {}
assert STREAMING_SYNTHESIZE_PATH == "/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize"
`], { env, encoding: "utf8" });
  assert.equal(execute.status, 0, execute.stdout + execute.stderr);
  const types = spawnSync("pyright", ["--pythonversion", "3.13", path.join(temporary, "changed.py")], { cwd: path.join(root, "sdks/python"), env, encoding: "utf8" });
  assert.equal(types.status, 0, types.stdout + types.stderr);
} finally { rmSync(temporary, { recursive: true, force: true }); }

// This fixture renderer knows Go value syntax, not protobuf tags or wire bytes.
// Compare checked-in/generated encoders with independent protobufjs wire output.
function goFixture(sources: readonly ProtoSource[], service: string, method: string) {
  const graph = parseGoogleProtobuf(sources, service, method);
  function scalar(field: protobuf.Field, value: unknown): string {
    if (field.resolvedType instanceof protobuf.Type) return message(field.resolvedType, value as Record<string, unknown>);
    if (field.resolvedType instanceof protobuf.Enum) return `${graph.name(field.resolvedType)}(${graph.name(field.resolvedType)}_${String(value)}{})`;
    if (field.type === "bytes") return `[]byte{${[...Buffer.from(value as string, "base64")].join(",")}}`;
    const type = { string: "string", bool: "bool", double: "float64", int32: "int32", uint32: "uint32" }[field.type];
    assert.notEqual(type, undefined);
    return `${type}(${JSON.stringify(value)})`;
  }
  function message(type: protobuf.Type, value: Record<string, unknown>): string {
    const fields: string[] = [];
    const oneofs = type.oneofsArray.filter(group => group.fieldsArray.some(field => !field.options?.proto3_optional));
    for (const [key, item] of Object.entries(value)) {
      const field = type.fields[key]; assert.notEqual(field, undefined, `Unknown fixture field: ${type.fullName}.${key}`);
      const group = oneofs.find(group => group.fieldsArray.includes(field!));
      const required = field!.options?.["(google.api.field_behavior)"] === "REQUIRED";
      if (group) fields.push(`${pascal(group.name)}: ${graph.name(type)}_${pascal(key)}{Value: ${scalar(field!, item)}}`);
      else if (field!.repeated) {
        const element = field!.resolvedType ? graph.name(field!.resolvedType) : { string: "string", bytes: "[]byte" }[field!.type];
        assert.notEqual(element, undefined);
        fields.push(`${pascal(key)}: []${element}{${(item as unknown[]).map(value => scalar(field!, value)).join(",")}}`);
      } else fields.push(`${pascal(key)}: ${required ? scalar(field!, item) : `runtime.Some(${scalar(field!, item)})`}`);
    }
    return `${graph.name(type)}{${fields.join(",")}}`;
  }
  return { graph, message };
}
const goTemporary = mkdtempSync(path.join(tmpdir(), "google-protobuf-go-"));
try {
  for (const version of ["v1", "v1beta1"] as const) {
    const source = version === "v1" ? sources[0]! : { name: "google/cloud/texttospeech/v1beta1/cloud_tts.proto", text: readFileSync(path.join(root, "schemas/sources/google/03-cloud-tts-v1beta1.proto"), "utf8") };
    const packageName = version === "v1" ? "google_grpc" : "google_grpc_beta";
    const input = [source, ...sources.slice(1)];
    const { graph, message } = goFixture(input, `google.cloud.texttospeech.${version}.TextToSpeech`, "StreamingSynthesize");
    const tests = fixtures.map((fixture: { request: Record<string, unknown>; hex: string }, index: number) => `func TestGolden${index}(t *testing.T) { data, err := EncodeStreamingRequest(${message(graph.request, fixture.request)}); if err != nil || hex.EncodeToString(data) != ${JSON.stringify(fixture.hex)} { t.Fatalf("wire: %x, %v", data, err) } }`);
    writeFileSync(path.join(goTemporary, "client.go"), readFileSync(path.join(root, `sdks/go/clients/${packageName}/client.go`), "utf8"));
    writeFileSync(path.join(goTemporary, "client_test.go"), `package ${packageName}\nimport ("testing"; "encoding/hex"; "github.com/speechswitch/client/sdks/go/runtime")\n${tests.join("\n")}\n`);
    const result = spawnSync("go", ["test", path.join(goTemporary, "client.go"), path.join(goTemporary, "client_test.go")], { cwd: path.join(root, "sdks/go"), encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const extended = changed.map(source => ({ ...source, text: source.name.endsWith("cloud_tts.proto") ? source.text
    .replace("rpc StreamingSynthesize(", "rpc SpeakLive(")
    .replaceAll("optional bool experimental = 99;", "optional bool experimental = 99; optional uint32 count = 100; repeated string hints = 101; oneof experiment { string label = 102; bool enabled = 103; }")
    .replaceAll("bytes audio_content = 11;", "bytes audio_content = 11; repeated string notices = 12; optional bool ready = 13; double score = 14; int32 signed = 15; uint32 counter = 16; ReplyDetails details = 17;")
    + "\nmessage ReplyDetails { string id = 1; }\n" : source.text }));
  const { graph, message } = goFixture(extended, service, "SpeakLive");
  const requests = [
    { input: { text: "hi", experimental: false, count: 0, hints: ["one", "two"], enabled: false } },
    { input: { markup: "pause", label: "tag" } },
    { streamingConfig: { voice: { languageCode: "en-US" }, streamingAudioConfig: { audioEncoding: "PCM" } } },
  ];
  const response = { audioContent: "AQI=", notices: ["one", "two"], ready: false, score: 1.25, signed: -3, counter: 0xFFFFFFFF, details: { id: "nested" } };
  const responseHex = Buffer.from(graph.response.encode(graph.response.fromObject(response)).finish()).toString("hex");
  const harness = requests.map((value, index) => {
    const expected = Buffer.from(graph.request.encode(graph.request.fromObject(value)).finish()).toString("hex");
    return `func TestChangedRequest${index}(t *testing.T) { data, err := EncodeStreamingRequest(${message(graph.request, value)}); if err != nil || hex.EncodeToString(data) != ${JSON.stringify(expected)} { t.Fatalf("wire: %x, %v", data, err) } }`;
  }).join("\n");
  writeFileSync(path.join(goTemporary, "client.go"), renderGoogleProtobufGo(extended, service, "SpeakLive", "changed"));
  writeFileSync(path.join(goTemporary, "client_test.go"), `package changed
import ("encoding/hex"; "reflect"; "testing"; "github.com/speechswitch/client/sdks/go/runtime")
${harness}
func TestChangedResponse(t *testing.T) {
    data, err := hex.DecodeString(${JSON.stringify(responseHex)}); if err != nil { t.Fatal(err) }
    value, err := DecodeStreamingResponse(data)
    if err != nil || !reflect.DeepEqual(value, ${message(graph.response, response)}) { t.Fatalf("response: %#v, %v", value, err) }
    absent, err := DecodeStreamingResponse([]byte{10, 2, 1, 2})
    if err != nil || absent.AudioContent.Present { t.Fatalf("old tag still active: %#v, %v", absent, err) }
    if StreamingSynthesizePath != "/google.cloud.texttospeech.v1.TextToSpeech/SpeakLive" { t.Fatal(StreamingSynthesizePath) }
}
`);
  const result = spawnSync("go", ["test", path.join(goTemporary, "client.go"), path.join(goTemporary, "client_test.go")], { cwd: path.join(root, "sdks/go"), encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
} finally { rmSync(goTemporary, { recursive: true, force: true }); }
console.log("Google protobuf mutations change executed Python/Go types, bytes and decoders; shared TypeScript/Python/Go wire fixtures agree with the upstream parser.");
