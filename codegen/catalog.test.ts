import { describe, expect, test } from "bun:test";
import { parseCatalog } from "./catalog.ts";

describe("source catalog", () => {
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
