import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderCambClient } from "./camb-client.ts";
import { decodeMessage, streamSpeech } from "../sdk/generated/clients/camb.ts";

async function sources() {
  const http = JSON.parse(await readFile(new URL("../schemas/sources/camb/00-openapi.json", import.meta.url), "utf8"));
  const live = JSON.parse(await readFile(new URL("../schemas/sources/camb/01-asyncapi.json", import.meta.url), "utf8"));
  return { http, live };
}

test("CAMB generation follows changed request types, constraints, and required fields", async () => {
  const { http, live } = await sources();
  const original = renderCambClient(http, live, []);
  const schema = http.components.schemas.CreateStreamTTSRequestPayload;
  schema.properties.text = { type: "integer", minimum: 5 };
  schema.properties.extra_flag = { type: "boolean" };
  schema.required.push("extra_flag");
  const changed = renderCambClient(http, live, []);
  expect(changed.client).not.toBe(original.client);
  expect(changed.client).toContain('readonly "text": number');
  expect(changed.client).toContain('value["text"] >= 5');
  expect(changed.client).toContain('readonly "extra_flag": boolean');
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(changed.client);
  const module = new Function(`${javascript.replace(/^export /gm, "")}\nreturn { streamSpeech };`)();
  const options = { apiKey: "test", baseUrl: "https://test.invalid", signal: new AbortController().signal, fetch: async () => new Response() };
  expect(() => module.streamSpeech({ text: "hello", language: "en-us", voice_id: 1, extra_flag: true }, options)).toThrow("Invalid CAMB");
  expect(() => module.streamSpeech({ text: 8, language: "en-us", voice_id: 1 }, options)).toThrow("Invalid CAMB");
  expect((await module.streamSpeech({ text: 8, language: "en-us", voice_id: 1, extra_flag: true }, options)).ok).toBe(true);
});

test("CAMB generation derives HTTP paths, auth header names, and server addresses", async () => {
  const { http, live } = await sources();
  http.paths["/new-tts"] = http.paths["/tts-stream"];
  delete http.paths["/tts-stream"];
  http.components.securitySchemes.APIKeyHeader.name = "new-key";
  http.servers[0].url = "https://new.invalid/api";
  const generated = renderCambClient(http, live, []).client;
  expect(generated).toContain('"https://new.invalid/api"');
  expect(generated).toContain('+ "/new-tts"');
  expect(generated).toContain('"new-key": options.apiKey');
});

test("CAMB generation derives server message unions rather than fixing a known message list", async () => {
  const { http, live } = await sources();
  live.components.messages.Added = { name: "Added", contentType: "application/json", payload: { type: "object", properties: { type: { type: "string", const: "added" }, count: { type: "integer" } }, required: ["type", "count"] } };
  live.channels.liveTts.messages.Added = { $ref: "#/components/messages/Added" };
  live.operations.serverSend.messages.push({ $ref: "#/channels/liveTts/messages/Added" });
  const generated = renderCambClient(http, live, []).client;
  expect(generated).toContain("export type Added =");
  expect(generated).toContain("SessionError | Added;");
  expect(generated).toContain('value["type"] === "added"');
  expect(generated).toContain('Number.isInteger(value["count"])');
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
