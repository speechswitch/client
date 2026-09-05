import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { parseCatalog } from "../../../codegen/catalog.ts";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";

const root = path.resolve(import.meta.dirname, "../../..");

test("Deepgram snapshots retain their cataloged content hashes", async () => {
  const catalog = parseCatalog(YAML.parse(await readFile(path.join(root, "schemas/sources.yaml"), "utf8")));
  const sources = catalog.sources.filter(source => source.provider === "deepgram");
  assert.equal(sources.length, 7);
  for (const source of sources) {
    const bytes = await readFile(path.join(root, source.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.path);
  }
});

test("the unchanged AsyncAPI repeats overlapping control-message alternatives", async () => {
  const document = YAML.parse(await readFile(path.join(root, "schemas/sources/deepgram/01-asyncapi.yaml"), "utf8"));
  assert.deepEqual([
    document.components.schemas.ChannelsSpeakV1MessagesSpeakV1ClearType.enum,
    document.components.schemas.ChannelsSpeakV1MessagesSpeakV1CloseType.enum,
    document.components.schemas.ChannelsSpeakV1MessagesSpeakV1ClearedType.enum,
  ], [["Flush", "Clear", "Close"], ["Flush", "Clear", "Close"], ["Flushed", "Cleared"]]);
});

test("the OpenAPI models synchronous audio as an empty JSON object", async () => {
  const document = YAML.parse(await readFile(path.join(root, "schemas/sources/deepgram/00-openapi.yaml"), "utf8"));
  assert.deepEqual(document.paths["/v1/speak"].post.responses["200"].content, {
    "application/json": { schema: { $ref: "#/components/schemas/speak_v1_audio_generate_Response_200" } },
  });
  assert.deepEqual(document.components.schemas.speak_v1_audio_generate_Response_200, {
    type: "object", properties: {}, description: "Empty response body", title: "speak_v1_audio_generate_Response_200",
  });
});

test("authored model, language, and voice variants cover the catalog in both transports", async () => {
  const document = YAML.parse(await readFile(path.join(root, "schemas/sources/deepgram/00-openapi.yaml"), "utf8"));
  const request = extractRepositorySpeechSpec(root).tts.providers.find(provider => provider.id === "deepgram")!.request;
  assert.equal(request.kind, "union");
  const models = { string: new Set<string>(), "async-iterable": new Set<string>() };
  for (const branch of request.anyOf) {
    assert.equal(branch.kind, "object");
    const fields = Object.fromEntries(branch.fields.map(field => [field.name, field.type]));
    assert.equal(fields.model!.kind, "literal");
    assert.equal(fields.language!.kind, "literal");
    const text = fields.text!.kind;
    assert.ok(text === "string" || text === "async-iterable");
    const voice = fields.voice!;
    for (const value of voice.kind === "union" ? voice.anyOf : [voice]) {
      assert.equal(value.kind, "literal");
      models[text].add(`${fields.model!.value === "aura-1" ? "aura" : "aura-2"}-${value.value}-${fields.language!.value}`);
    }
  }
  const expected = [...document.components.schemas.V1SpeakPostParametersModel.enum].sort();
  assert.deepEqual([...models.string].sort(), expected);
  assert.deepEqual([...models["async-iterable"]].sort(), expected);
});
