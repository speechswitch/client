import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; path: string; sha256: string }[];
test("Mistral retains every first-party snapshot unchanged with a catalog hash", () => {
  const sources = catalog.filter(source => source.provider === "mistral");
  expect(sources.length).toBe(11);
  expect(sources.map(source => source.path.split("/").at(-1)).sort()).toEqual(readdirSync(new URL("schemas/sources/mistral/", root)).sort());
  for (const source of sources) expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
});
test("Mistral's checked-in contract is stale and the docs contract has unresolved root references", () => {
  const old = parse(readFileSync(new URL("schemas/sources/mistral/00-openapi.yaml", root), "utf8"));
  const current = parse(readFileSync(new URL("schemas/sources/mistral/03-docs-openapi.yaml", root), "utf8"));
  expect(old.components.schemas.SpeechRequest.properties.metadata).toBeUndefined();
  expect(old.components.schemas.SpeechRequest.properties.prompt_cache_key).toBeUndefined();
  expect(current.components.schemas.SpeechRequest.properties.metadata).toEqual({ anyOf: [{ $ref: "#/components/schemas/MetadataDict" }, { type: "null" }] });
  expect(current.components.schemas.SpeechRequest.properties.prompt_cache_key).toEqual({ anyOf: [{ type: "string" }, { type: "null" }], title: "Prompt Cache Key" });
  const events = current.paths["/v1/audio/speech"].post.responses["200"].content["text/event-stream"].schema;
  expect(events.properties.event.$ref).toBe("#/$defs/SpeechStreamEventTypes");
  expect(current.$defs).toBeUndefined();
  expect(events.$id).toBeUndefined();
  expect(events.$defs.SpeechStreamEventTypes.enum).toEqual(["speech.audio.delta", "speech.audio.done"]);
  expect(old.components.schemas.UsageInfo.properties.completion_tokens.type).toBe("integer");
  expect(events.$defs.UsageInfo.properties.completion_tokens.anyOf).toEqual([{ type: "integer" }, { type: "null" }]);
});
