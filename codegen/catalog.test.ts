import { describe, expect, test } from "bun:test";
import { parseCatalog } from "./catalog.ts";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import YAML from "yaml";

describe("source catalog", () => {
  test("all raw snapshots retain their cataloged hashes, including handwritten providers", async () => {
    const root = new URL("../", import.meta.url);
    const catalog = parseCatalog(YAML.parse(await readFile(new URL("schemas/sources.yaml", root), "utf8")));
    for (const source of catalog.sources) {
      const raw = await readFile(new URL(source.path, root));
      expect(createHash("sha256").update(raw).digest("hex"), source.path).toBe(source.sha256);
    }
  });

  test("preserves an exact POST acquisition recipe and rejects a GET body", () => {
    const source = { provider: "test", name: "api", format: "openapi", path: "raw.json", url: "https://example.invalid", sha256: "a".repeat(64), method: "POST", body: '{"export":true}' } as const;
    expect(parseCatalog({ sources: [source] }).sources[0]).toEqual(source);
    expect(() => parseCatalog({ sources: [{ ...source, method: "GET" }] })).toThrow("body requires POST");
  });
  test("accepts the zero-source baseline", () => {
    expect(parseCatalog({ sources: [] })).toEqual({ sources: [] });
  });

  test("rejects duplicate provider APIs", () => {
    expect(() => parseCatalog({
      sources: [
        { provider: "fixture", name: "api", format: "openapi", path: "one.json", url: "https://one.invalid", sha256: "a".repeat(64) },
        { provider: "fixture", name: "api", format: "asyncapi", path: "two.json", url: "https://two.invalid", sha256: "b".repeat(64) },
      ],
    })).toThrow("Duplicate source");
  });

  test("rejects unknown fields and source formats", () => {
    expect(() => parseCatalog({ sources: [], extra: true })).toThrow("unknown field");
    expect(() => parseCatalog({
      sources: [{
        provider: "fixture",
        name: "api",
        format: "unknown",
        path: "schema.json",
        url: "https://example.invalid",
        sha256: "a".repeat(64),
      }],
    })).toThrow("unsupported format");
  });
});
