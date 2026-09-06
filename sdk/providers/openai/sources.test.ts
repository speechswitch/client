import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; path: string; sha256: string }[];
test("OpenAI retains all four first-party snapshots with exact catalog hashes", () => {
  const sources = catalog.filter(source => source.provider === "openai"); expect(sources.length).toBe(4);
  expect(sources.map(source => source.path.split("/").at(-1)).sort()).toEqual(readdirSync(new URL("schemas/sources/openai/", root)).sort());
  for (const source of sources) expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
});
test("OpenAI selected speech contract contains both response modes and referenced event definitions", () => {
  const source = parse(readFileSync(new URL("schemas/sources/openai/00-openapi.yaml", root), "utf8"));
  const operation = source.paths["/audio/speech"].post;
  expect(operation.operationId).toBe("createSpeech");
  expect(operation.requestBody).toEqual({ required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateSpeechRequest" } } } });
  expect(operation.responses["200"].content).toEqual({ "application/octet-stream": { schema: { type: "string", format: "binary" } }, "text/event-stream": { schema: { $ref: "#/components/schemas/CreateSpeechResponseStreamEvent" } } });
  expect(source.components.schemas.CreateSpeechRequest.required).toEqual(["model", "input", "voice"]);
  expect(source.components.schemas.SpeechAudioDoneEvent.properties.usage.required).toEqual(["input_tokens", "output_tokens", "total_tokens"]);
});
