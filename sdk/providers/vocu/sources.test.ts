import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
test("Vocu records every unchanged source and the exact successful Apifox acquisition", () => {
  const sources = (parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; name: string; path: string; url: string; method: string; body?: string; sha256: string }[]).filter(source => source.provider === "vocu");
  expect(sources.length).toBe(16);
  expect(sources.map(source => source.name).sort()).toEqual(readdirSync(new URL("schemas/sources/vocu/", root)).sort());
  for (const source of sources) {
    expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
    expect(source.method).toBe(source.name === "00-openapi.json" ? "POST" : "GET");
    expect(new URL(source.url).origin).toBe(["10-models.md", "11-generation-config.md", "12-task-guide.md", "17-guide-index.txt"].includes(source.name) ? "https://docs.vocu.studio" : "https://dev.vocu.studio");
  }
  expect(sources[0]!.url).toBe("https://dev.vocu.studio/raiz5jee8eiph0eeFooV/api/v1/projects/5436565/published-projects/export-data?branchId=6636476");
  expect(sources[0]!.body).toBe('{"type":"openapi","id":"5436565","version":"3.1","moduleId":5334740,"excludeExtension":true,"excludeTagsWithFolder":false,"branchId":6636476,"projectId":5878926}');
});

test("Vocu's incomplete contract cannot generate truthful wire types", () => {
  const api = JSON.parse(readFileSync(new URL("schemas/sources/vocu/00-openapi.json", root), "utf8"));
  expect(api.openapi).toBe("3.1.0"); expect(Object.keys(api.paths).length).toBe(21);
  expect(Object.keys(api.components.schemas).sort()).toEqual(["ErrorResponse", "General Generation Parameters (New)", "Generate", "Template", "Voice"]);
  const simple = api.paths["/api/tts/simple-generate"].post;
  const properties = simple.requestBody.content["application/json"].schema.properties;
  expect([properties.model, properties.direct_stream, properties.instruct_mode, properties.reference_mode]).toEqual([undefined, undefined, undefined, undefined]);
  expect(simple.security).toEqual([]);
  expect(api.paths["/api/tts/simple-generate.mp3"].get.responses["200"].content["audio/mpeg"].schema).toEqual({ type: "object", properties: {} });
  const task = api.paths["/api/tts/generate"].post.requestBody.content["application/json"].schema;
  expect(task.required).toEqual(["contents"]);
  expect([task.oneOf, task.properties.splitter, task.properties.splitterId]).toEqual([undefined, undefined, undefined]);
  expect(task.properties.contents.items.required).toEqual(["voiceId", "text"]);
  expect(task.properties.contents.items.properties.type.enum).toEqual(["text", "audio", "sfx", "music", "scene", "custom_audio", "stem_separation"]);
  expect(api.components.schemas.Generate.properties.type.enum).toEqual(["reecho-neural-voice-001"]);
  expect(api.paths["/api/tts/generate"].post.responses["200"].content["application/json"].example.data.type).toBe("vocu-neural-voice-001");
});
