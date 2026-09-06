import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { renderOpenaiClient } from "./openai-client.ts";
import { decodeSpeechEvent } from "../sdk/generated/clients/openai.ts";

const document = YAML.parse(readFileSync(new URL("../schemas/sources/openai/00-openapi.yaml", import.meta.url), "utf8"));
function source() { return structuredClone(document); }
function executable(raw: unknown) {
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(renderOpenaiClient(raw, "https://source.invalid"));
  return new Function(`${js.replace(/^export /gm, "")}\nreturn { createSpeech, decodeSpeechEvent, defaultBaseUrl, speechStatus };`)();
}
test("OpenAI emitted transport follows operation path, server and status changes", async () => {
  const raw = source(); raw.servers = [{ url: "https://proxy.invalid/root" }];
  raw.paths["/custom/speech"] = raw.paths["/audio/speech"]; delete raw.paths["/audio/speech"];
  const responses = raw.paths["/custom/speech"].post.responses; responses["201"] = responses["200"]; delete responses["200"];
  const generated = executable(raw); expect(generated.defaultBaseUrl).toBe("https://proxy.invalid/root"); expect(generated.speechStatus).toBe(201);
  let captured: unknown; const signal = new AbortController().signal; const request = { model: "tts-1", input: "Hi", voice: "alloy" };
  await generated.createSpeech(request, { apiKey: "test", baseUrl: "https://proxy.invalid/root/?tenant=one", signal, fetch: async (url: URL, init: RequestInit) => { captured = { url: String(url), init }; return new Response(); } });
  expect(captured).toEqual({ url: "https://proxy.invalid/root/custom/speech?tenant=one", init: { method: "POST", signal, redirect: "error", headers: { Authorization: "Bearer test", "Content-Type": "application/json", Accept: "application/octet-stream, text/event-stream" }, body: JSON.stringify(request) } });
});
test("OpenAI changed request bounds and fields affect executable validation", async () => {
  const raw = source(); const schema = raw.components.schemas.CreateSpeechRequest;
  schema.properties.input.maxLength = 2; schema.properties.enabled = { type: "boolean" }; schema.required.push("enabled");
  const generated = executable(raw); let calls = 0;
  const options = { apiKey: "test", baseUrl: "https://api.invalid", signal: new AbortController().signal, fetch: async () => { calls++; return new Response(); } };
  for (const request of [{ input: "abc", enabled: false }, { input: "Hi" }, { input: "Hi", enabled: "false" }]) assert.throws(() => generated.createSpeech({ model: "tts-1", voice: "alloy", ...request }, options), { name: "TypeError", message: "Invalid OpenAI speech wire request" });
  await generated.createSpeech({ model: "tts-1", voice: { id: "saved" }, input: "😀😀", enabled: false }, options); expect(calls).toBe(1);
});
test("OpenAI SSE literal and usage types come from the source graph", () => {
  const done = { type: "speech.audio.done", usage: { input_tokens: 0, output_tokens: 1, total_tokens: 1 } } as const;
  expect(decodeSpeechEvent(done)).toEqual(done);
  const raw = source(); raw.components.schemas.SpeechAudioDoneEvent.properties.type.enum = ["speech.completed"];
  raw.components.schemas.SpeechAudioDoneEvent.properties.usage.properties.input_tokens = { type: "string" };
  const generated = executable(raw);
  assert.throws(() => generated.decodeSpeechEvent(done), { name: "TypeError", message: "Invalid OpenAI speech event" });
  const updated = { type: "speech.completed", usage: { input_tokens: "0", output_tokens: 1, total_tokens: 1 } };
  expect(generated.decodeSpeechEvent(updated)).toEqual(updated);
});
test.each([
  [(raw: any) => { raw.components.schemas.CreateSpeechRequest.properties.input.pattern = "x"; }, "Unsupported OpenAI schema keyword: pattern"],
  [(raw: any) => { raw.components.schemas.CreateSpeechRequest.properties.input.anyOf = {}; }, "Invalid OpenAI anyOf"],
  [(raw: any) => { raw.components.schemas.CreateSpeechRequest.properties.input.required = ["hidden"]; }, "Unsupported OpenAI scalar object constraints"],
  [(raw: any) => { raw.components.schemas.CreateSpeechRequest.properties.voice = { $ref: "https://other.invalid/schema" }; }, "Unsupported OpenAI schema reference"],
  [(raw: any) => { raw.components.schemas.CreateSpeechRequest.properties.voice = { $ref: "#/components/schemas/Absent" }; }, "Unresolved OpenAI reference: #/components/schemas/Absent"],
  [(raw: any) => { raw.components.schemas.CreateSpeechRequest.properties.voice = { $ref: "#/components/schemas/CreateSpeechRequest" }; }, "Recursive OpenAI schema reference"],
  [(raw: any) => { raw.paths["/audio/speech"].post.security = []; }, "Unsupported OpenAI security"],
  [(raw: any) => { raw.components.securitySchemes.ApiKeyAuth.scheme = "basic"; }, "Unsupported OpenAI authentication"],
  [(raw: any) => { raw.paths["/audio/speech"].post.parameters = []; }, "Unsupported OpenAI speech transport"],
  [(raw: any) => { raw.servers[0].variables = { region: { default: "us" } }; }, "Unsupported OpenAI server variables"],
  [(raw: any) => { raw.paths["/audio/speech"].post.responses["200"].content["application/octet-stream"].schema.maxLength = 10; }, "Expected OpenAI binary audio response"],
  [(raw: any) => { delete raw.paths["/audio/speech"].post.responses["200"].content["text/event-stream"]; }, "Unsupported OpenAI speech response media"],
] as const)("OpenAI selected graph fails closed on unsupported semantics %#", (mutate, message) => {
  const raw = source(); mutate(raw); expect(() => renderOpenaiClient(raw, "test")).toThrow(new TypeError(message));
});
