import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/mistral.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "mistral")!;
test("Mistral playground preserves arbitrary JSON metadata and the fixed PCM representation", () => {
  const request = materializedRequest(provider, { text: "Hello", voice: "saved", metadata: '{"count":0,"nested":[null,false,{"label":"one"}]}', output: { format: "pcm" } });
  assert.deepEqual(request, { text: "Hello", voice: "saved", model: "voxtral-mini-tts-2603", metadata: { count: 0, nested: [null, false, { label: "one" }] },
    output: { format: "pcm", sampleRateHz: 24000, sampleEncoding: "float_32", byteOrder: "little_endian", channelCount: 1 } });
  validateRequest(request); assert.equal(provider.streamingText, undefined);
});
test("Mistral playground does not require a saved voice when reference audio is used", () => {
  const request = materializedRequest(provider, { text: "Hello", referenceAudio: [0, 255, 128] });
  assert.deepEqual(request, { text: "Hello", referenceAudio: [0, 255, 128], model: "voxtral-mini-tts-2603" });
});
