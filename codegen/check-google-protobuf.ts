import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import protobuf from "protobufjs";
import { renderGoogleProtobufPython } from "./google-protobuf-python.ts";
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
console.log("Google protobuf source mutations change executed Python bytes and types; shared Python/TypeScript wire fixtures agree with the upstream parser.");
