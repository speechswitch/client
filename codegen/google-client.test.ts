import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderGoogleDiscovery } from "./google-discovery.ts";
import { renderGoogleDiscoveryPython } from "./google-discovery-python.ts";
import { renderGoogleDiscoveryGo } from "./google-discovery-go.ts";
import { renderGoogleDiscoveryRust } from "./google-discovery-rust.ts";
import { renderGoogleProtobuf } from "./google-protobuf.ts";
import { renderGoogleProtobufPython } from "./google-protobuf-python.ts";
import { renderGoogleProtobufGo } from "./google-protobuf-go.ts";
import { renderGoogleProtobufRust } from "./google-protobuf-rust.ts";
import { encodeStreamingRequest, decodeStreamingResponse } from "../sdk/generated/clients/google-grpc.ts";
import protobuf from "protobufjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { ProtoReader, ProtoWriter } from "../sdk/runtime/protobuf.ts";

const root = new URL("../", import.meta.url).pathname;
const discovery = JSON.parse(readFileSync(join(root, "schemas/sources/google/00-discovery.json"), "utf8"));
const directory = join(root, "schemas/sources/google/imports");
const sources = [
  { name: "google/cloud/texttospeech/v1/cloud_tts.proto", text: readFileSync(join(root, "schemas/sources/google/02-cloud-tts-v1.proto"), "utf8") },
  ...readdirSync(directory, { recursive: true }).filter((name): name is string => typeof name === "string" && name.endsWith(".proto")).map(name => ({ name, text: readFileSync(join(directory, name), "utf8") })),
];
const service = "google.cloud.texttospeech.v1.TextToSpeech";

test("Discovery object key order does not change any generated target", () => {
  function reversed(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reversed);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversed(item)]));
    return value;
  }
  for (const render of [renderGoogleDiscovery, renderGoogleDiscoveryPython, renderGoogleDiscoveryRust, (raw: unknown, source: string) => renderGoogleDiscoveryGo(raw, source, "fixture")]) {
    expect(render(reversed(discovery), "source")).toBe(render(discovery, "source"));
  }
});

test("Python Discovery generation fails on unsupported or ambiguous schema changes", () => {
  const missing = structuredClone(discovery);
  missing.schemas.SynthesisInput.properties.experimental = { $ref: "Missing" };
  expect(() => renderGoogleDiscoveryPython(missing, "source")).toThrow(new TypeError("Unresolved Google Discovery reference: Missing"));
  const mixed = structuredClone(discovery);
  mixed.schemas.SynthesisInput.additionalProperties = { type: "string" };
  expect(() => renderGoogleDiscoveryPython(mixed, "source")).toThrow(new TypeError("Google Discovery mixed map/object schemas need explicit support"));
  const collision = structuredClone(discovery);
  collision.schemas.SynthesisInput.properties.experimental = { type: "object", properties: {} };
  collision.schemas.SynthesisInput.properties.another = { $ref: "SynthesisInputExperimental" };
  collision.schemas.SynthesisInputExperimental = { type: "object", properties: {} };
  expect(() => renderGoogleDiscoveryPython(collision, "source")).toThrow(new TypeError("Colliding or invalid Python Discovery type: SynthesisInputExperimental"));
  const required = structuredClone(discovery);
  required.schemas.SynthesisInput.required = ["unknown"];
  expect(() => renderGoogleDiscoveryPython(required, "source")).toThrow(new TypeError("Unknown required Google Discovery field: SynthesisInput"));
  const scalar = structuredClone(discovery);
  scalar.schemas.SynthesisInput.properties.text = { type: "null" };
  expect(() => renderGoogleDiscoveryPython(scalar, "source")).toThrow(new TypeError("Unsupported Google Discovery type: null"));
});

test("Discovery targets share fail-closed transport selection", () => {
  for (const render of [renderGoogleDiscovery, renderGoogleDiscoveryPython, renderGoogleDiscoveryRust, (raw: unknown, source: string) => renderGoogleDiscoveryGo(raw, source, "fixture")]) {
    const media = structuredClone(discovery);
    media.resources.text.methods.synthesize.supportsMediaUpload = true;
    expect(() => render(media, "source")).toThrow(new TypeError("Google TTS media semantics require a generator update"));
    const query = structuredClone(discovery);
    query.resources.text.methods.synthesize.parameters = { extra: { type: "string", location: "query" } };
    expect(() => render(query, "source")).toThrow(new TypeError("Google Discovery body plus query requires an explicit generated input shape"));
    const path = structuredClone(discovery);
    path.resources.voices.methods.list.parameters.languageCode.location = "path";
    expect(() => render(path, "source")).toThrow(new TypeError("Unsupported Google Discovery parameter: languageCode"));
  }
});

test("Go Discovery rejects unresolved, recursive, colliding and unsupported schemas", () => {
  const missing = structuredClone(discovery);
  missing.schemas.SynthesisInput.properties.experimental = { $ref: "Missing" };
  expect(() => renderGoogleDiscoveryGo(missing, "source", "fixture")).toThrow(new TypeError("Unresolved Google Discovery reference: Missing"));
  const recursive = structuredClone(discovery);
  recursive.schemas.SynthesisInput.properties.experimental = { $ref: "SynthesisInput" };
  expect(() => renderGoogleDiscoveryGo(recursive, "source", "fixture")).toThrow(new TypeError("Recursive Go Discovery schema: SynthesisInput"));
  const mixed = structuredClone(discovery);
  mixed.schemas.SynthesisInput.additionalProperties = { type: "string" };
  expect(() => renderGoogleDiscoveryGo(mixed, "source", "fixture")).toThrow(new TypeError("Google Discovery mixed map/object schemas need explicit support"));
  const unknownRequired = structuredClone(discovery);
  unknownRequired.schemas.SynthesisInput.required = ["unknown"];
  expect(() => renderGoogleDiscoveryGo(unknownRequired, "source", "fixture")).toThrow(new TypeError("Unknown required Google Discovery field: SynthesisInput"));
  const collision = structuredClone(discovery);
  collision.schemas.SynthesisInput.properties.Text = { type: "string" };
  expect(() => renderGoogleDiscoveryGo(collision, "source", "fixture")).toThrow(new TypeError("Colliding or invalid Go Discovery field: SynthesisInput.Text"));
  const format = structuredClone(discovery);
  format.schemas.AudioConfig.properties.sampleRateHertz.format = "int128";
  expect(() => renderGoogleDiscoveryGo(format, "source", "fixture")).toThrow(new TypeError("Unsupported Go Discovery integer format: int128"));
});

test("protobuf codegen rejects flattened name collisions instead of dropping fields", () => {
  const sources = [{ name: "fixture.proto", text: `syntax = "proto3"; package fixture;
message A { message B { string text = 1; } }
message AB { bytes audio = 1; }
message Request { A.B first = 1; AB second = 2; }
message Response { bytes audio = 1; }
service Speech { rpc Speak(stream Request) returns (stream Response); }` }];
  expect(() => renderGoogleProtobuf(sources, "fixture.Speech", "Speak")).toThrow(new TypeError("Colliding protobuf type name: AB"));
  expect(() => renderGoogleProtobufPython(sources, "fixture.Speech", "Speak")).toThrow(new TypeError("Colliding protobuf type name: AB"));
});

test("Rust Discovery rejects unresolved, recursive, ambiguous and unsupported schemas", () => {
  const missing = structuredClone(discovery);
  missing.schemas.SynthesisInput.properties.experimental = { $ref: "Missing" };
  expect(() => renderGoogleDiscoveryRust(missing, "source")).toThrow(new TypeError("Unresolved Google Discovery reference: Missing"));
  const recursive = structuredClone(discovery);
  recursive.schemas.SynthesisInput.properties.experimental = { $ref: "SynthesisInput" };
  expect(() => renderGoogleDiscoveryRust(recursive, "source")).toThrow(new TypeError("Recursive Rust Discovery schema: SynthesisInput"));
  const cyclicAlias = structuredClone(discovery);
  cyclicAlias.schemas.Alias = { $ref: "Alias" };
  cyclicAlias.schemas.SynthesisInput.properties.text = { $ref: "Alias" };
  expect(() => renderGoogleDiscoveryRust(cyclicAlias, "source")).toThrow(new TypeError("Recursive Rust Discovery schema: Alias"));
  const mixed = structuredClone(discovery);
  mixed.schemas.SynthesisInput.additionalProperties = { type: "string" };
  expect(() => renderGoogleDiscoveryRust(mixed, "source")).toThrow(new TypeError("Google Discovery mixed map/object schemas need explicit support"));
  const required = structuredClone(discovery);
  required.schemas.SynthesisInput.required = ["unknown"];
  expect(() => renderGoogleDiscoveryRust(required, "source")).toThrow(new TypeError("Unknown required Google Discovery field: SynthesisInput"));
  const collision = structuredClone(discovery);
  collision.schemas.SynthesisInput.properties.Text = { type: "string" };
  expect(() => renderGoogleDiscoveryRust(collision, "source")).toThrow(new TypeError("Rust Discovery field collision: SynthesisInput.Text"));
  const enumCollision = structuredClone(discovery);
  enumCollision.schemas.AudioConfig.properties.audioEncoding.enum.push("mp3");
  expect(() => renderGoogleDiscoveryRust(enumCollision, "source")).toThrow(new TypeError("Rust Discovery enum variant collision: AudioConfigAudioEncoding"));
  const format = structuredClone(discovery);
  format.schemas.AudioConfig.properties.sampleRateHertz.format = "int128";
  expect(() => renderGoogleDiscoveryRust(format, "source")).toThrow(new TypeError("Unsupported Rust Discovery integer format: int128"));
  const shadow = structuredClone(discovery);
  shadow.schemas.String = { type: "string" };
  shadow.schemas.SynthesisInput.properties.text = { $ref: "String" };
  expect(() => renderGoogleDiscoveryRust(shadow, "source")).toThrow(new TypeError("Colliding or invalid Rust Discovery identifier: String"));
});

test("Python protobuf response shapes fail generation when unsupported", () => {
  const oneof = sources.map(source => ({ ...source, text: source.text.replaceAll("bytes audio_content = 1;", "oneof result { bytes audio_content = 1; string error = 2; }") }));
  expect(() => renderGoogleProtobufPython(oneof, service, "StreamingSynthesize")).toThrow(new TypeError("Google response oneof decoding needs explicit support"));
  const required = sources.map(source => ({ ...source, text: source.text.replaceAll("bytes audio_content = 1;", "bytes audio_content = 1 [(google.api.field_behavior) = REQUIRED];") }));
  expect(() => renderGoogleProtobufPython(required, service, "StreamingSynthesize")).toThrow(new TypeError("Google required response field decoding needs explicit support"));
});

test("Go protobuf rejects unsupported graph changes and ambiguous names before emission", () => {
  const mutate = (replacement: string) => sources.map(source => ({ ...source, text: source.text.replaceAll("bytes audio_content = 1;", replacement) }));
  for (const [replacement, message] of [
    ["oneof result { bytes audio_content = 1; string error = 2; }", "Google response oneof decoding needs explicit support"],
    ["bytes audio_content = 1 [(google.api.field_behavior) = REQUIRED];", "Google required response field decoding needs explicit support"],
    ["AudioEncoding audio_content = 1;", "Google response enum decoding is not supported"],
    ["repeated int32 audio_content = 1;", "Packed Go protobuf fields need explicit support: .google.cloud.texttospeech.v1.StreamingSynthesizeResponse.audioContent"],
    ["StreamingSynthesizeResponse child = 2; bytes audio_content = 1;", "Recursive Go protobuf message: StreamingSynthesizeResponse"],
  ]) {
    expect(() => renderGoogleProtobufGo(mutate(replacement!), service, "StreamingSynthesize", "fixture")).toThrow(new TypeError(message));
  }
  expect(() => renderGoogleProtobufGo(sources, service, "StreamingSynthesize", "package")).toThrow(new TypeError("Invalid Go protobuf package: package"));
  const collision = [{ name: "fixture.proto", text: `syntax = "proto3"; package fixture;
message Request { string field = 1; string Field = 2; }
message Response { bytes audio = 1; }
service Speech { rpc Speak(stream Request) returns (stream Response); }` }];
  expect(() => renderGoogleProtobufGo(collision, "fixture.Speech", "Speak", "fixture")).toThrow(new TypeError("Go protobuf field collision: Request"));
});

test("Rust protobuf rejects unsupported graphs and normalized name collisions", () => {
  const mutate = (replacement: string) => sources.map(source => ({ ...source, text: source.text.replaceAll("bytes audio_content = 1;", replacement) }));
  for (const [replacement, message] of [
    ["oneof result { bytes audio_content = 1; string error = 2; }", "Google response oneof decoding needs explicit support"],
    ["bytes audio_content = 1 [(google.api.field_behavior) = REQUIRED];", "Google required response field decoding needs explicit support"],
    ["AudioEncoding audio_content = 1;", "Google response enum decoding is not supported"],
    ["repeated int32 audio_content = 1;", "Packed Rust protobuf fields need explicit support: .google.cloud.texttospeech.v1.StreamingSynthesizeResponse.audioContent"],
    ["StreamingSynthesizeResponse child = 2; bytes audio_content = 1;", "Recursive Rust protobuf message: StreamingSynthesizeResponse"],
  ]) expect(() => renderGoogleProtobufRust(mutate(replacement!), service, "StreamingSynthesize")).toThrow(new TypeError(message));
  for (const [definition, message] of [
    ["message Request { string field = 1; string Field = 2; }", "Rust protobuf field collision: Request"],
    ["message Request { string type = 1; string type_ = 2; }", "Rust protobuf field collision: Request"],
    ["enum Choice { FOO = 0; foo = 1; } message Request { Choice choice = 1; }", "Rust protobuf enum variant collision: Choice"],
    ["message Reader { string text = 1; } message Request { Reader reader = 1; }", "Colliding or invalid Rust protobuf identifier: Reader"],
    ["message Request { oneof source { string field = 1; string Field = 2; } }", "Rust protobuf oneof variant collision: RequestSource"],
  ]) {
    const input = [{ name: "fixture.proto", text: `syntax = "proto3"; package fixture; ${definition} message Response { bytes audio = 1; } service Speech { rpc Speak(stream Request) returns (stream Response); }` }];
    expect(() => renderGoogleProtobufRust(input, "fixture.Speech", "Speak")).toThrow(new TypeError(message));
  }
});

async function generatedModule(source: string): Promise<Record<string, any>> {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const javascript = transpiler.transformSync(source);
  const exports = Array.from(javascript.matchAll(/^export (?:function|const) (\w+)/gm), match => match[1]);
  return new Function("ProtoReader", "ProtoWriter", `${javascript.replace(/^import .*;\n/gm, "").replace(/^export /gm, "")}\nreturn { ${exports.join(", ")} };`)(ProtoReader, ProtoWriter);
}

test("Google Discovery drives executed method paths, verbs, query parameters and schema declarations", async () => {
  const changed = structuredClone(discovery);
  changed.resources.text.methods.synthesize.path = "v2/speech:render";
  changed.resources.voices.methods.list.path = "v2/catalog";
  changed.resources.voices.methods.list.parameters = { locale: { type: "string", location: "query" } };
  changed.schemas.SynthesisInput.properties.experimentalText = { type: "string" };
  const generated = renderGoogleDiscovery(changed, "https://source.invalid/discovery");
  const directory = await mkdtemp(join(tmpdir(), "google-discovery-types-"));
  try {
    await writeFile(join(directory, "generated.ts"), generated.replace('"../../runtime/fetch.ts"', JSON.stringify(join(root, "sdk/runtime/fetch.ts"))));
    await writeFile(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], lib: ["ESNext", "DOM"] }, include: ["generated.ts"] }));
    const script = `import { API } from ${JSON.stringify(pathToFileURL(join(root, "node_modules/typescript/dist/api/sync/api.js")).href)};
      const api = new API({ cwd: process.argv[1] });
      try { const config = process.argv[1] + "/tsconfig.json"; const snapshot = api.updateSnapshot({ openProjects: [config] });
        try { const project = snapshot.getProject(config); const checker = project.checker;
          const file = project.program.getSourceFile(process.argv[1] + "/generated.ts");
          const symbol = checker.getMemberInModuleExports(checker.getSymbolAtLocation(file), "SynthesisInput");
          process.stdout.write(JSON.stringify(checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)).map(field => field.name).sort()));
        } finally { snapshot.dispose(); }
      } finally { api.close(); }`;
    const child = Bun.spawn(["node", "--input-type=module", "-e", script, directory], { stdout: "pipe", stderr: "pipe" });
    const [status, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(status, errors).toBe(0);
    expect(JSON.parse(output)).toEqual(["customPronunciations", "experimentalText", "markup", "multiSpeakerMarkup", "prompt", "ssml", "text"]);
  } finally { await rm(directory, { recursive: true }); }
  const module = await generatedModule(generated);
  const calls: unknown[] = [];
  const options = { baseUrl: "https://proxy.invalid/google/?tenant=one", headers: { authorization: "Bearer test" }, signal: new AbortController().signal, fetch: async (url: URL, init: RequestInit) => {
    calls.push({ url: url.href, method: init.method, headers: init.headers, body: init.body }); return new Response();
  } };
  await module.synthesizeSpeech({ input: { experimentalText: "hello" } }, options);
  await module.listVoices({ locale: "en US" }, options);
  expect(calls).toEqual([
    { url: "https://proxy.invalid/google/v2/speech:render?tenant=one", method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: '{"input":{"experimentalText":"hello"}}' },
    { url: "https://proxy.invalid/google/v2/catalog?tenant=one&locale=en+US", method: "GET", headers: { authorization: "Bearer test" }, body: undefined },
  ]);
});

test("Google protobuf field-number and enum changes alter executed bytes", async () => {
  const changed = sources.map(source => ({ ...source, text: source.name.endsWith("cloud_tts.proto") ? source.text.replace("StreamingSynthesisInput input = 2;", "StreamingSynthesisInput input = 9;").replace("PCM = 7;", "PCM = 19;") : source.text }));
  const module = await generatedModule(renderGoogleProtobuf(changed, service, "StreamingSynthesize"));
  expect(module.encodeStreamingRequest({ input: { text: "hi" } })).toEqual(Uint8Array.of(0x4a, 4, 0x0a, 2, 104, 105));
  expect(module.encodeStreamingAudioConfig({ audioEncoding: "PCM" })).toEqual(Uint8Array.of(8, 19));
});

test("generated protobuf agrees with independently parsed upstream messages, including oneofs and explicit false", () => {
  const parsed = new protobuf.Root(); for (const source of sources) protobuf.parse(source.text, parsed); parsed.resolveAll();
  const request = parsed.lookupType("google.cloud.texttospeech.v1.StreamingSynthesizeRequest");
  const value = { streamingConfig: { voice: { languageCode: "en-US", name: "Kore", modelName: "gemini-2.5-pro-tts" }, streamingAudioConfig: { audioEncoding: "PCM", speakingRate: 1.25, sampleRateHertz: 24000 }, advancedVoiceOptions: { enableTextnorm: false } } } as const;
  const bytes = encodeStreamingRequest(value);
  expect(bytes).toEqual(Uint8Array.from(request.encode(request.fromObject(value)).finish()));
  expect(decodeStreamingResponse(Uint8Array.of(10, 3, 1, 2, 3))).toEqual({ audioContent: Uint8Array.of(1, 2, 3) });
});

test("Google protobuf response field changes affect decoding, not merely generated banners", async () => {
  const changed = sources.map(source => ({ ...source, text: source.name.endsWith("cloud_tts.proto") ? source.text.replaceAll("bytes audio_content = 1;", "bytes audio_content = 11;") : source.text }));
  const module = await generatedModule(renderGoogleProtobuf(changed, service, "StreamingSynthesize"));
  expect(module.decodeStreamingResponse(Uint8Array.of(90, 2, 1, 2))).toEqual({ audioContent: Uint8Array.of(1, 2) });
  expect(module.decodeStreamingResponse(Uint8Array.of(10, 2, 1, 2))).toEqual({});
});

test("protobuf preserves an absent oneof and rejects simultaneous alternatives", () => {
  expect(encodeStreamingRequest({})).toEqual(new Uint8Array());
  // @ts-expect-error protobuf oneof cannot have both members.
  expect(() => encodeStreamingRequest({ input: { text: "hi" }, streamingConfig: { voice: { languageCode: "en" } } })).toThrow(new TypeError("StreamingSynthesizeRequest.streamingRequest permits at most one field"));
});

test("codegen rejects uncataloged imports, unsupported wire scalars, missing refs and changed streaming semantics", () => {
  expect(() => renderGoogleProtobuf(sources.slice(0, 1), service, "StreamingSynthesize")).toThrow(new TypeError("Uncataloged protobuf import: google/api/annotations.proto"));
  const unary = sources.map(source => ({ ...source, text: source.text.replace("returns (stream StreamingSynthesizeResponse)", "returns (StreamingSynthesizeResponse)") }));
  expect(() => renderGoogleProtobuf(unary, service, "StreamingSynthesize")).toThrow(new TypeError("Google synthesis RPC must remain bidirectional"));
  const scalar = sources.map(source => ({ ...source, text: source.text.replaceAll("string text = 1;", "sint64 text = 1;") }));
  expect(() => renderGoogleProtobuf(scalar, service, "StreamingSynthesize")).toThrow(new TypeError("Unsupported protobuf scalar: sint64"));
  const changed = structuredClone(discovery); changed.schemas.SynthesizeSpeechRequest.properties.input.$ref = "Missing";
  expect(() => renderGoogleDiscovery(changed, "source")).toThrow(new TypeError("Unresolved Google Discovery reference: Missing"));
  const media = structuredClone(discovery); media.resources.text.methods.synthesize.supportsMediaDownload = true;
  expect(() => renderGoogleDiscovery(media, "source")).toThrow(new TypeError("Google TTS media semantics require a generator update"));
});
