import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const spec = JSON.parse(readFileSync(new URL("../../../schemas/sources/kugelaudio/00-openapi.json", import.meta.url), "utf8"));
test("KugelAudio's OpenAPI is not a complete streaming contract", () => {
  assert.deepEqual(Object.keys(spec.paths).filter(path => path.startsWith("/ws/")), []);
  assert.deepEqual(spec.paths["/v1/tts/generate"].post.responses["200"], {
    description: "Successful Response", content: { "application/json": { schema: {} } },
  });
  assert.deepEqual(spec.components.schemas.SynthesizeRequest.required, ["text"]);
  assert.deepEqual(spec.components.schemas.SynthesizeRequest.properties.model_id, {
    anyOf: [{ type: "string" }, { type: "null" }], title: "Model Id", description: "Model to use",
  });
  assert.equal(spec.components.schemas.SynthesizeRequest.additionalProperties, false);
  assert.equal(spec.components.schemas.SynthesizeRequest.properties.word_timestamps, undefined);
  assert.equal(spec.components.schemas.SynthesizeRequest.properties.speaker_prefix, undefined);
});
