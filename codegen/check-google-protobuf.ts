import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import protobuf from "protobufjs";
import { renderGoogleProtobufPython } from "./google-protobuf-python.ts";
import { renderGoogleProtobufGo } from "./google-protobuf-go.ts";
import { renderGoogleProtobufRust } from "./google-protobuf-rust.ts";
import { pascal, snake } from "./language-types.ts";
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
// Rust fixture construction uses message declarations, not generated codecs or
// wire tags. Protobufjs independently determines all expected bytes.
function rustFixture(input: readonly ProtoSource[], service: string, method: string) {
  const graph = parseGoogleProtobuf(input, service, method);
  const name = (type: protobuf.ReflectionObject) => pascal(graph.name(type));
  function scalar(field: protobuf.Field, value: unknown): string {
    if (field.resolvedType instanceof protobuf.Type) return message(field.resolvedType, value as Record<string, unknown>);
    if (field.resolvedType instanceof protobuf.Enum) return `${name(field.resolvedType)}::${pascal(snake(String(value)))}`;
    if (field.type === "bytes") return `vec![${[...Buffer.from(value as string, "base64")].join(",")}]`;
    if (field.type === "string") {
      assert.equal(typeof value, "string"); assert.equal((value as string).isWellFormed(), true);
      const quoted = [...value as string].map(char => char === "\\" ? "\\\\" : char === '"' ? '\\"' : char.codePointAt(0)! < 32 ? `\\u{${char.codePointAt(0)!.toString(16)}}` : char).join("");
      return `"${quoted}".into()`;
    }
    if (field.type === "bool") return String(value);
    const suffix = { double: "f64", int32: "i32", uint32: "u32" }[field.type]; assert.notEqual(suffix, undefined);
    return `${Object.is(value, -0) ? "-0.0" : value}${suffix}`;
  }
  function message(type: protobuf.Type, value: Record<string, unknown>): string {
    for (const key of Object.keys(value)) assert.notEqual(type.fields[key], undefined, `Unknown fixture field: ${type.fullName}.${key}`);
    const oneofs = type.oneofsArray.filter(group => group.fieldsArray.some(field => !field.options?.proto3_optional));
    const grouped = new Set(oneofs.flatMap(group => group.fieldsArray)); const fields: string[] = [];
    for (const field of type.fieldsArray.filter(field => !grouped.has(field))) {
      const required = field.options?.["(google.api.field_behavior)"] === "REQUIRED";
      let expression: string;
      if (field.repeated) expression = `vec![${((value[field.name] ?? []) as unknown[]).map(item => scalar(field, item)).join(",")}]`;
      else if (field.name in value) expression = required ? scalar(field, value[field.name]) : `Some(${scalar(field, value[field.name])})`;
      else { assert.equal(required, false, `Missing fixture field: ${field.fullName}`); expression = "None"; }
      fields.push(`${snake(field.name)}: ${expression}`);
    }
    for (const group of oneofs) {
      const selected = group.fieldsArray.filter(field => field.name in value); assert.ok(selected.length <= 1);
      const field = selected[0];
      fields.push(`${snake(group.name)}: ${field ? `Some(${name(type) + pascal(group.name)}::${pascal(snake(field.name))}(${scalar(field, value[field.name])}))` : "None"}`);
    }
    return `${name(type)} { ${fields.join(",")} }`;
  }
  return { graph, message };
}
function checkRust(input: readonly ProtoSource[], service: string, method: string, generated: string, requests: readonly Record<string, unknown>[], response?: Record<string, unknown>, mergedResponse?: { parts: readonly Record<string, unknown>[]; expected: Record<string, unknown> }) {
  const temporary = mkdtempSync(path.join(tmpdir(), "google-protobuf-rust-"));
  try {
    const { graph, message } = rustFixture(input, service, method);
    const tests = requests.map((value, index) => {
      const expected = [...graph.request.encode(graph.request.fromObject(value)).finish()];
      return `#[test] fn request_${index}() { assert_eq!(encode_streaming_request(&${message(graph.request, value)}).unwrap(), vec![${expected}]); }`;
    });
    if (response) {
      const bytes = [...graph.response.encode(graph.response.fromObject(response)).finish()];
      tests.push(`#[test] fn changed_response() {
        assert_eq!(decode_streaming_response(&[${bytes}]).unwrap(), ${message(graph.response, response)});
        assert_eq!(decode_streaming_response(&[10,2,1,2]).unwrap().audio_content, None);
      }`);
    }
    if (mergedResponse) {
      // Concatenation must merge singular messages and append repeated fields;
      // the expected object is explicit, independent of protobufjs's decoder.
      const bytes = mergedResponse.parts.flatMap(part => [...graph.response.encode(graph.response.fromObject(part)).finish()]);
      tests.push(`#[test] fn merge_response() {
        assert_eq!(decode_streaming_response(&[${bytes}]).unwrap(), ${message(graph.response, mergedResponse.expected)});
      }`);
    }
    tests.push(`#[test] fn path() { assert_eq!(STREAMING_SYNTHESIZE_PATH, ${JSON.stringify(graph.path)}); }`);
    writeFileSync(path.join(temporary, "wire.rs"), generated);
    writeFileSync(path.join(temporary, "tests.rs"), `#[path=${JSON.stringify(path.join(root, "sdks/rust/src/protobuf.rs"))}] mod protobuf;\nmod wire;\nuse wire::*;\n${tests.join("\n")}\n`);
    const binary = path.join(temporary, "tests");
    const compiled = spawnSync("rustc", ["--edition=2021", "--test", path.join(temporary, "tests.rs"), "-o", binary], { encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = spawnSync(binary, [], { encoding: "utf8" }); assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
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
    checkRust(input, `google.cloud.texttospeech.${version}.TextToSpeech`, "StreamingSynthesize", readFileSync(path.join(root, `sdks/rust/src/clients/${packageName}.rs`), "utf8"), fixtures.map((fixture: { request: Record<string, unknown> }) => fixture.request));
  }
  const extended = changed.map(source => ({ ...source, text: source.name.endsWith("cloud_tts.proto") ? source.text
    .replace("rpc StreamingSynthesize(", "rpc SpeakLive(")
    .replaceAll("optional bool experimental = 99;", "optional bool experimental = 99; optional uint32 count = 100; repeated string hints = 101; oneof experiment { string label = 102; bool enabled = 103; } optional string type = 104;")
    .replaceAll("bytes audio_content = 11;", "bytes audio_content = 11; repeated string notices = 12; optional bool ready = 13; double score = 14; int32 signed = 15; uint32 counter = 16; ReplyDetails details = 17;")
    + "\nmessage ReplyDetails { string id = 1; string hint = 2; repeated string labels = 3; }\n" : source.text }));
  const { graph, message } = goFixture(extended, service, "SpeakLive");
  const requests = [
    { input: { text: "hi", experimental: false, count: 0, hints: ["one\n\u0000", "two\\\""], enabled: false, type: "keyword" } },
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
  checkRust(extended, service, "SpeakLive", renderGoogleProtobufRust(extended, service, "SpeakLive"), requests, response, {
    parts: [
      { ready: true, notices: ["first"], details: { id: "preserved", hint: "old", labels: ["one"] } },
      { ready: false, notices: ["second"], details: { hint: "new", labels: ["two"] } },
      { details: {} },
    ],
    expected: { ready: false, notices: ["first", "second"], details: { id: "preserved", hint: "new", labels: ["one", "two"] } },
  });
} finally { rmSync(goTemporary, { recursive: true, force: true }); }
console.log("Google protobuf mutations change executed Python/Go/Rust types, bytes and decoders; all four languages agree with the upstream parser.");
