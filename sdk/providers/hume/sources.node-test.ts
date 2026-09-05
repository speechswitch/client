import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (name: string) => JSON.parse(readFileSync(new URL(`../../../schemas/sources/hume/${name}`, import.meta.url), "utf8"));
test("Hume Fern omits the stream response graph in both language representations", () => {
  const ir = source("00-fern-ir.json");
  for (const language of ["python", "typescript"]) {
    assert.deepEqual(ir[language].endpoints["endpoint_tts.synthesize-json-streaming"].response, { type: "streaming" });
    assert.deepEqual(ir[language].endpoints["endpoint_tts.synthesize-file-streaming"].response, { type: "fileDownload" });
  }
});
test("Hume AsyncAPI describes JSON only despite defaulting to binary responses", () => {
  const api = source("02-asyncapi.json");
  assert.deepEqual(api.channels["/stream/input"].bindings.ws.query.properties.no_binary, { type: "boolean", default: false });
  assert.deepEqual(api.components.schemas.TtsOutput.oneOf.map((type: any) => type.properties.type.enum), [["audio"], ["timestamp"]]);
  assert.equal(api.components.schemas.TtsOutput.oneOf[0].properties.audio.type, "string");
});
