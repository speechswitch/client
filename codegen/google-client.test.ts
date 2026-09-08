import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderGoogleDiscovery } from "./google-discovery.ts";
import { renderGoogleProtobuf } from "./google-protobuf.ts";
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
