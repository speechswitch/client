import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { typecastContract } from "./typecast-client.ts";

describe("Typecast client generation", () => {
  test("selects the canonical synthesis and voice operations", async () => {
    const [api, skill, docs] = await Promise.all([
      readFile("schemas/sources/typecast/00-openapi.json", "utf8"),
      readFile("schemas/sources/typecast/01-markdown.md", "utf8"),
      readFile("schemas/sources/typecast/02-llms-txt.txt", "utf8"),
    ]);
    expect(typecastContract(JSON.parse(api), skill, docs)).toEqual({ server: "https://api.typecast.ai", models: ["ssfm-v30", "ssfm-v21"] });
  });
});
