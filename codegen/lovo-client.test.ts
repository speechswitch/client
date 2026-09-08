import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderLovoClient } from "./lovo-client.ts";
import { decodeCreateSpeech } from "../sdk/generated/clients/lovo.ts";

function source() { return JSON.parse(readFileSync(new URL("../schemas/sources/lovo/00-openapi.json", import.meta.url), "utf8")); }
function executable(raw: unknown) {
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(renderLovoClient(raw, "https://api.genny.lovo.ai/api/docs-json"));
  return new Function(`${js.replace(/^export /gm, "")}\nreturn { createSpeech, getSpeechJob, decodeCreateSpeech, defaultBaseUrl, createSpeechStatus };`)();
}
const output = { status: "succeeded", text: "Hi", speaker: "voice", speakerStyle: "style", speed: 1, pause: [], emphasis: [], pronunciations: [], urls: ["https://audio.invalid/result"] } as const;
const job = { id: "job", type: "tts", status: "done", progress: 1, team: "team", createdAt: "2026-09-05T00:00:00Z", data: [output] } as const;

test("LOVO generation derives method, route, path parameters, auth header, server and success status", async () => {
  const raw = source(); raw.servers[0].url = "https://new.invalid/root/?tenant=one";
  raw.components.securitySchemes["X-API-KEY"].name = "new-key";
  raw.paths["/new/{id}"] = { post: raw.paths["/api/v1/tts/{jobId}"].get }; delete raw.paths["/api/v1/tts/{jobId}"];
  raw.paths["/new/{id}"].post.parameters[0].name = "id";
  raw.paths["/api/v1/tts/sync"].post.responses["202"] = raw.paths["/api/v1/tts/sync"].post.responses["201"]; delete raw.paths["/api/v1/tts/sync"].post.responses["201"];
  const generated = executable(raw); expect(generated.defaultBaseUrl).toBe("https://new.invalid/root/?tenant=one"); expect(generated.createSpeechStatus).toBe(202);
  let captured: unknown; const signal = new AbortController().signal;
  await generated.getSpeechJob({ id: "a/b?x" }, { baseUrl: generated.defaultBaseUrl, apiKey: "test", signal, fetch: async (url: URL, init: RequestInit) => { captured = { url: String(url), init }; return new Response(); } });
  expect(captured).toEqual({ url: "https://new.invalid/root/new/a%2Fb%3Fx?tenant=one", init: { method: "POST", headers: { "new-key": "test" }, signal, redirect: "error" } });
});

test("LOVO request schema changes alter executed validation rather than a generated banner", async () => {
  const raw = source(); const request = raw.components.schemas.TextToSpeechSyncRequest;
  request.properties.text = { type: "integer", minimum: 5, maximum: 10 }; request.properties.enabled = { type: "boolean" }; request.required.push("enabled");
  const generated = executable(raw); let captured: unknown;
  const options = { baseUrl: "https://test.invalid", apiKey: "key", signal: new AbortController().signal, fetch: async (_url: URL, init: RequestInit) => { captured = JSON.parse(init.body as string); return new Response(); } };
  for (const input of [{ text: "Hi", speaker: "v", enabled: true }, { text: 7, speaker: "v" }, { text: 4, speaker: "v", enabled: false }, { text: 7.5, speaker: "v", enabled: false }]) {
    assert.throws(() => generated.createSpeech(input, options), { name: "TypeError", message: "Invalid LOVO sync-tts request" });
  }
  await generated.createSpeech({ text: 7, speaker: "v", enabled: false }, options); expect(captured).toEqual({ text: 7, speaker: "v", enabled: false });
});

test("LOVO nested response types, requiredness and literals come from the raw graph", () => {
  expect(decodeCreateSpeech(job)).toEqual(job);
  const raw = source(); const item = raw.components.schemas.TextToSpeechOutput;
  item.properties.urls.items = { type: "integer" }; item.required.push("urls"); item.properties.status.enum = ["new_status"];
  const generated = executable(raw);
  assert.throws(() => generated.decodeCreateSpeech(job), { name: "TypeError", message: "Invalid LOVO sync-tts response" });
  const changed = { ...job, data: [{ ...output, status: "new_status", urls: [1] }] };
  expect(generated.decodeCreateSpeech(changed)).toEqual(changed);
  assert.throws(() => generated.decodeCreateSpeech({ ...changed, data: [{ ...output, status: "new_status", urls: undefined }] }), { name: "TypeError", message: "Invalid LOVO sync-tts response" });
});

test("LOVO selected contract fails closed on unsupported or missing schema and transport semantics", () => {
  const cases: [(raw: any) => void, string][] = [
    [raw => { raw.components.schemas.TextToSpeechSyncRequest.properties.text.pattern = "x"; }, "Unsupported LOVO schema keyword: pattern"],
    [raw => { raw.components.schemas.TextToSpeechSyncRequest.properties.text = { $ref: "https://other.invalid/schema" }; }, "Unsupported LOVO reference"],
    [raw => { raw.components.schemas.TextToSpeechSyncRequest.properties.text = { $ref: "#/components/schemas/Absent" }; }, "Unresolved LOVO reference: Absent"],
    [raw => { raw.components.schemas.TextToSpeechSyncRequest.properties.text = { $ref: "#/components/schemas/TextToSpeechSyncRequest" }; }, "Recursive LOVO reference: TextToSpeechSyncRequest"],
    [raw => { raw.paths["/api/v1/tts/sync"].post.security = []; }, "Unsupported LOVO security requirements"],
    [raw => { raw.paths["/api/v1/tts/sync"].post.parameters = [{ name: "q", in: "query", schema: { type: "string" } }]; }, "Unsupported LOVO parameter"],
    [raw => { raw.paths["/api/v1/tts/sync"].parameters = []; }, "Unsupported LOVO path-level transport"],
    [raw => { delete raw.paths["/api/v1/tts/sync"].post.responses["201"].content; }, "Expected a LOVO contract object"],
  ];
  for (const [change, message] of cases) { const raw = source(); change(raw); expect(() => renderLovoClient(raw, "test")).toThrow(new TypeError(message)); }
});

test("current LOVO TTS graph has no model, output format, streaming-text or alignment operations", () => {
  const raw = source();
  expect(Object.keys(raw.paths).filter(path => path.startsWith("/api/v1/tts")).sort()).toEqual(["/api/v1/tts", "/api/v1/tts/sync", "/api/v1/tts/{jobId}"]);
  expect(Object.keys(raw.components.schemas.TextToSpeechSyncRequest.properties).sort()).toEqual(["speaker", "speakerStyle", "speed", "text"]);
  expect(raw.components.schemas.TextToSpeechSyncRequest.properties.speed).toEqual({ type: "number", default: 1, minimum: 0.05, maximum: 3, description: "Speed of the audio to be generated" });
});
