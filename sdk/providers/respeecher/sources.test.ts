import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; name: string; path: string; sha256: string; method?: string; url: string }[];
test("Respeecher catalogs every unchanged source with its URL, acquisition method and hash", () => {
  const sources = catalog.filter(source => source.provider === "respeecher");
  expect(sources.length).toBe(10);
  expect(sources.map(source => source.name).sort()).toEqual(readdirSync(new URL("schemas/sources/respeecher/", root)).sort());
  for (const source of sources) {
    expect(source.method).toBe("GET");
    expect(new URL(source.url).origin).toBe("https://space.respeecher.com");
    expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
  }
});
test("raw contracts retain JSONL framing and missing socket auth instead of hand-repaired codegen", () => {
  const http = JSON.parse(readFileSync(new URL("schemas/sources/respeecher/00-openapi.json", root), "utf8"));
  const socket = JSON.parse(readFileSync(new URL("schemas/sources/respeecher/01-asyncapi.json", root), "utf8"));
  expect(Object.keys(http.paths).sort()).toEqual(["/tts/bytes", "/tts/sse", "/voices"]);
  expect(http.paths["/tts/sse"].post.responses["200"].content).toEqual({ "text/event-stream": { schema: { $ref: "#/components/schemas/type_tts:ServerSentEvent" } } });
  expect(http.paths["/tts/bytes"].post.requestBody.required).toBeUndefined();
  expect(socket.components.securitySchemes).toBeUndefined();
  expect(Object.keys(socket.channels)).toEqual(["/tts/websocket"]);
  expect(socket.components.schemas["type_tts:ContextfulGenerationRequest"].required).toEqual(["transcript", "voice", "context_id"]);
  expect(socket.components.schemas["type_tts:StreamingEncoding"].enum).toEqual(["pcm_f32le", "pcm_s16le", "pcm_mulaw"]);
  expect(socket.components.schemas["type_voices:SamplingParams"].properties.top_p).toEqual({ type: "number", format: "double", description: "Must be greater than 0 and less than or equal to 1." });
});
