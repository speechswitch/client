import { describe, expect, test } from "bun:test";
import { parseCatalog } from "./catalog.ts";

describe("source catalog", () => {
  test("accepts the zero-source baseline", () => {
    expect(parseCatalog({ sources: [] })).toEqual({ sources: [] });
  });

  test("rejects duplicate source identifiers", () => {
    expect(() => parseCatalog({
      sources: [
        { id: "fixture", format: "openapi", path: "one.json" },
        { id: "fixture", format: "asyncapi", path: "two.json" },
      ],
    })).toThrow("Duplicate source id");
  });

  test("rejects unknown fields and source formats", () => {
    expect(() => parseCatalog({ sources: [], extra: true })).toThrow("unknown field");
    expect(() => parseCatalog({
      sources: [{ id: "fixture", format: "unknown", path: "schema.json" }],
    })).toThrow("unsupported format");
  });
});
