import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; name: string; path: string; sha256: string; method?: string; url: string }[];
test("Smallest.ai preserves and catalogs all fifteen upstream snapshots", () => {
  const sources = catalog.filter(source => source.provider === "smallest.ai");
  expect(sources.length).toBe(15);
  expect(sources.map(source => source.name).sort()).toEqual(readdirSync(new URL("schemas/sources/smallest.ai/", root)).sort());
  for (const source of sources) {
    expect(source.method).toBe("GET");
    expect(["https://docs.smallest.ai", "https://raw.githubusercontent.com"].includes(new URL(source.url).origin)).toBe(true);
    expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
  }
});

test("OpenAPI/AsyncAPI omit streaming control shapes and contradict their own prose", () => {
  const http = parse(readFileSync(new URL("schemas/sources/smallest.ai/00-openapi.yaml", root), "utf8"));
  const ws = parse(readFileSync(new URL("schemas/sources/smallest.ai/01-asyncapi.yaml", root), "utf8"));
  const messages = ws.channels.ttsStream.messages;
  const request = messages["ttsRequest.message"].payload;
  const response = messages["ttsResponse.message"].payload;
  expect(request.required).toEqual(["voice_id", "text"]); // Even though context_close may omit both.
  expect(request.properties.cancel_request).toBeUndefined();
  expect(request.properties.output_format).toBeUndefined();
  expect(request.properties.pronunciation_dicts).toBeUndefined();
  expect(request.properties.sample_rate.enum).toBeUndefined();
  expect(response.required).toBeUndefined();
  expect(response.properties.status.enum).toEqual(["chunk", "word_timestamp", "complete"]); // Error is not reachable in this message union.
  expect(Object.keys(http.paths["/waves/v1/tts/live"].post.responses["200"].content)).toEqual(["text/event-stream"]);
  expect(http.paths["/waves/v1/tts/live"].post.responses["200"].content["text/event-stream"].schema.type).toBe("string");
  expect(http.components.schemas.TtsRequest.properties.model.enum).toEqual(["lightning_v3.1", "lightning_v3.1_pro"]);
  expect(http.components.schemas.TtsRequest.properties.sample_rate.enum).toEqual([8000, 16000, 24000, 44100]);
});

test("the hosted AsyncAPI still omits documented context and keep-alive frames", () => {
  const markdown = readFileSync(new URL("schemas/sources/smallest.ai/14-ws-reference.md", root), "utf8");
  const yaml = markdown.match(/^```yaml\n([\s\S]*?)^```/m)?.[1];
  expect(typeof yaml).toBe("string");
  const ws = parse(yaml!);
  expect(ws.asyncapi).toBe("2.6.0");
  const schemas = ws.components.schemas;
  const request = schemas["ttsStream_ttsRequest.message"];
  expect(request.required).toEqual(["voice_id", "text"]);
  expect(request.properties.cancel_request).toBeUndefined();
  expect(request.properties.output_format).toBeUndefined();
  expect(request.properties.type).toBeUndefined();
  expect(request.properties.sample_rate.enum).toBeUndefined();
  expect(schemas["ttsStream_ttsResponse.message"].required).toBeUndefined();
  expect(schemas.ChannelsTtsStreamMessagesTtsResponseMessageStatus.enum).toEqual(["chunk", "word_timestamp", "complete"]);
});
