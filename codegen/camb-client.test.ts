import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderCambClient } from "./camb-client.ts";
import { decodeMessage, streamSpeech } from "../sdk/generated/clients/camb.ts";

async function sources() {
  const http = JSON.parse(await readFile(new URL("../schemas/sources/camb/00-openapi.json", import.meta.url), "utf8"));
  const live = JSON.parse(await readFile(new URL("../schemas/sources/camb/01-asyncapi.json", import.meta.url), "utf8"));
  return { http, live };
}

function executable(source: string) {
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  return new Function(`${javascript.replace(/^export /gm, "")}\nreturn { streamSpeech, decodeMessage, defaultBaseUrl };`)();
}

test("CAMB generation follows changed request types, constraints, and required fields", async () => {
  const { http, live } = await sources();
  const schema = http.components.schemas.CreateStreamTTSRequestPayload;
  schema.properties.text = { type: "integer", minimum: 5 };
  schema.properties.extra_flag = { type: "boolean" };
  schema.required.push("extra_flag");
  const changed = renderCambClient(http, live, []);
  const module = executable(changed.client);
  const options = { apiKey: "test", baseUrl: "https://test.invalid", signal: new AbortController().signal, fetch: async () => new Response() };
  assert.throws(() => module.streamSpeech({ text: "hello", language: "en-us", voice_id: 1, extra_flag: true }, options), { name: "TypeError", message: "Invalid CAMB HTTP synthesis request" });
  assert.throws(() => module.streamSpeech({ text: 8, language: "en-us", voice_id: 1 }, options), { name: "TypeError", message: "Invalid CAMB HTTP synthesis request" });
  assert.throws(() => module.streamSpeech({ text: 4, language: "en-us", voice_id: 1, extra_flag: true }, options), { name: "TypeError", message: "Invalid CAMB HTTP synthesis request" });
  expect((await module.streamSpeech({ text: 8, language: "en-us", voice_id: 1, extra_flag: true }, options)).ok).toBe(true);
});

test("CAMB generation derives HTTP paths, auth header names, and server addresses", async () => {
  const { http, live } = await sources();
  http.paths["/new-tts"] = http.paths["/tts-stream"];
  delete http.paths["/tts-stream"];
  http.components.securitySchemes.APIKeyHeader.name = "new-key";
  http.servers[0].url = "https://new.invalid/api";
  const generated = renderCambClient(http, live, []).client;
  const module = executable(generated);
  expect(module.defaultBaseUrl).toBe("https://new.invalid/api");
  let captured: unknown;
  const signal = new AbortController().signal;
  await module.streamSpeech({ text: "hello", language: "en-us", voice_id: 1 }, {
    apiKey: "test-key", baseUrl: module.defaultBaseUrl, signal,
    fetch: async (url: string, init: RequestInit) => { captured = { url, init }; return new Response(); },
  });
  expect(captured).toEqual({ url: "https://new.invalid/api/new-tts", init: {
    method: "POST", headers: { "new-key": "test-key", "content-type": "application/json" },
    body: JSON.stringify({ text: "hello", language: "en-us", voice_id: 1 }), signal,
  } });
});

test("CAMB generation derives server message unions rather than fixing a known message list", async () => {
  const { http, live } = await sources();
  live.components.messages.Added = { name: "Added", contentType: "application/json", payload: { type: "object", properties: { type: { type: "string", const: "added" }, count: { type: "integer" } }, required: ["type", "count"] } };
  live.channels.liveTts.messages.Added = { $ref: "#/components/messages/Added" };
  live.operations.serverSend.messages.push({ $ref: "#/channels/liveTts/messages/Added" });
  const generated = renderCambClient(http, live, []).client;
  const module = executable(generated);
  expect(module.decodeMessage('{"type":"added","count":3}')).toEqual({ type: "added", count: 3 });
  assert.throws(() => module.decodeMessage('{"type":"added","count":3.5}'), { name: "TypeError", message: "Invalid CAMB WebSocket message" });
  assert.throws(() => module.decodeMessage('{"type":"added"}'), { name: "TypeError", message: "Invalid CAMB WebSocket message" });
});

test("CAMB rejects unsupported or incomplete contracts instead of generating guesses", async () => {
  const { http, live } = await sources();
  http.components.schemas.CreateStreamTTSRequestPayload.properties.text.pattern = "[a-z]";
  expect(() => renderCambClient(http, live, [])).toThrow("Unsupported CAMB schema keyword: pattern");
  delete http.components.schemas.CreateStreamTTSRequestPayload.properties.text.pattern;
  live.operations.serverSend.messages[0].$ref = "#/missing";
  expect(() => renderCambClient(http, live, [])).toThrow();
});

test("CAMB preserves nullable fields and validates nested response payloads", () => {
  expect(decodeMessage(JSON.stringify({ type: "segment.start", segment_id: 1, text: "hello", word_timestamps: null }))).toEqual({ type: "segment.start", segment_id: 1, text: "hello", word_timestamps: null });
  expect(() => decodeMessage(JSON.stringify({ type: "segment.start", segment_id: 1, text: "hello", word_timestamps: [{ word: "hello", start: "0", end: 1 }] }))).toThrow();
  expect(() => decodeMessage(JSON.stringify({ type: "session.ready", session_id: "id", run_id: 1 }))).toThrow();
  expect(() => decodeMessage(JSON.stringify({ type: "segment.done", segment_id: null }))).toThrow();
  const data = Uint8Array.of(9, 1, 2, 9);
  expect(decodeMessage(data.subarray(1, 3))).toEqual(Uint8Array.of(1, 2));
});

test("generated HTTP validation uses the entire selected contract", async () => {
  const options = { apiKey: "test", baseUrl: "https://proxy.invalid/apis", signal: new AbortController().signal, fetch: async () => new Response(Uint8Array.of(1)) };
  expect(() => streamSpeech({ text: "hi", language: "en-us", voice_id: 1 }, options)).toThrow("Invalid CAMB");
  // @ts-expect-error The generated contract also narrows the HTTP locale statically.
  expect(() => streamSpeech({ text: "hello", language: "invented", voice_id: 1 }, options)).toThrow("Invalid CAMB");
  expect(() => streamSpeech({ text: "hello", language: "en-us", voice_id: 0 }, options)).toThrow("Invalid CAMB");
  expect((await streamSpeech({ text: "hello", language: "en-us", voice_id: 1, voice_settings: { speaking_rate: null } }, options)).ok).toBe(true);
});
