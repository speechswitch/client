import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
test("Typecast catalogs every unchanged source with URL, method and content hash", () => {
  const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; name: string; path: string; url: string; method?: string; sha256: string }[];
  const sources = catalog.filter(source => source.provider === "typecast");
  expect(sources.length).toBe(8);
  expect(sources.map(source => source.name).sort()).toEqual(readdirSync(new URL("schemas/sources/typecast/", root)).sort());
  for (const source of sources) {
    expect(source.method).toBe("GET");
    expect(new URL(source.url).origin).toBe(source.name === "07-sdk-models.go" ? "https://raw.githubusercontent.com" : "https://typecast.ai");
    expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
  }
});

test("canonical OpenAPI has typeless legacy prompts and overlapping alternatives, not a safe generation contract", () => {
  const api = JSON.parse(readFileSync(new URL("schemas/sources/typecast/00-openapi.json", root), "utf8"));
  const schemas = api.components.schemas;
  expect(api.openapi).toBe("3.1.0"); expect(Object.keys(api.paths).length).toBe(16); expect(Object.keys(schemas).length).toBe(40);
  expect(schemas.Prompt.type).toBeUndefined(); expect(schemas.Prompt.required).toBeUndefined(); expect(schemas.Prompt.additionalProperties).toBeUndefined();
  expect(Object.keys(schemas.Prompt.properties).sort()).toEqual(["emotion_intensity", "emotion_preset"]);
  expect(Object.values(schemas.Prompt.properties).map((value: any) => value.type)).toEqual([undefined, undefined]);
  expect(schemas.TTSRequest.properties.prompt.oneOf).toEqual([
    { $ref: "#/components/schemas/SmartPrompt" }, { $ref: "#/components/schemas/PresetPrompt" }, { $ref: "#/components/schemas/Prompt" },
  ]);
  expect(schemas.SmartPrompt.properties.previous_text.maxLength).toBeUndefined();
  expect(schemas.Output.oneOf).toBeUndefined(); expect(schemas.Output.not).toBeUndefined();
  expect(schemas.OutputStreamStream.properties.volume).toBeUndefined();
  expect(schemas.ComposeRequest.properties.segments.minItems).toBe(1); expect(schemas.ComposeRequest.properties.segments.maxItems).toBe(50);
  expect(schemas.TTSWithTimestampsResponse.required).toEqual(["audio", "audio_format", "audio_duration", "words", "characters"]);
});
