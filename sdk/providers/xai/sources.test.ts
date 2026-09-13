import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";

test("xAI catalogs every raw snapshot with its upstream URL and content hash", () => {
  const root = new URL("../../../", import.meta.url);
  const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")) as {
    sources: { provider: string; path: string; url: string; sha256: string }[];
  };
  const sources = catalog.sources.filter(source => source.provider === "xai");
  expect(sources.map(source => source.url)).toEqual([
    "https://docs.x.ai/developers/rest-api-reference/inference/voice",
    "https://docs.x.ai/llms.txt",
    "https://docs.x.ai/developers/rest-api-reference/inference/voice.md",
    "https://docs.x.ai/developers/model-capabilities/audio/text-to-speech.md",
  ]);
  expect(sources.map(source => source.path).sort()).toEqual(
    readdirSync(new URL("schemas/sources/xai/", root)).sort().map(name => `schemas/sources/xai/${name}`),
  );
  for (const source of sources) {
    expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
  }
});
