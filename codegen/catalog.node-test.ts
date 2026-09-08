import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseCatalog } from "./catalog.ts";

describe("source catalog", () => {
  test("accepts the zero-source baseline", () => {
    assert.deepEqual(parseCatalog({ sources: [] }), { sources: [] });
  });

  test("rejects duplicate provider APIs", () => {
    assert.throws(() => parseCatalog({
      sources: [
        { provider: "fixture", name: "api", format: "openapi", path: "one.json", url: "https://one.invalid", sha256: "a".repeat(64) },
        { provider: "fixture", name: "api", format: "asyncapi", path: "two.json", url: "https://two.invalid", sha256: "b".repeat(64) },
      ],
    }), /Duplicate source/);
  });

  test("rejects unknown fields and source formats", () => {
    assert.throws(() => parseCatalog({ sources: [], extra: true }), /unknown field/);
    assert.throws(() => parseCatalog({
      sources: [{
        provider: "fixture",
        name: "api",
        format: "unknown",
        path: "schema.json",
        url: "https://example.invalid",
        sha256: "a".repeat(64),
      }],
    }), /unsupported format/);
  });
});
