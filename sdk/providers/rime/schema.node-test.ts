import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/rime.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "rime")!;
test("Rime playground materializes model/language and codec-specific defaults", () => {
  const coda = materializedRequest(provider, { model: "coda", voice: "custom", text: "Hello", output: { format: "pcm" } });
  assert.deepEqual(coda, { model: "coda", voice: "custom", text: "Hello", language: "en", speed: 1,
    output: { format: "pcm", sampleRateHz: 24000, sampleEncoding: "signed_integer_16", byteOrder: "little_endian" } });
  validateRequest(coda);
  const mist = materializedRequest(provider, { model: "mist-v2", voice: "custom", text: "Hello", output: { format: "mulaw" }, textNormalization: false });
  assert.deepEqual(mist, { model: "mist-v2", voice: "custom", text: "Hello", language: "en", speed: 1,
    output: { format: "mulaw", sampleRateHz: 8000 }, textNormalization: false });
  validateRequest(mist);
  const english = materializedRequest(provider, { model: "mist-v3", voice: "custom", text: "Hello", textMarkup: { phonemes: true } });
  assert.deepEqual(english, { model: "mist-v3", voice: "custom", text: "Hello", language: "en", speed: 1, textMarkup: { phonemes: true } });
  validateRequest(english);
});

test("Rime alternatives encode timestamp/phoneme language restrictions in the authored type graph", () => {
  const request = spec.tts.providers.find(value => value.id === "rime")!.request;
  assert.equal(request.kind, "union"); if (request.kind !== "union") throw new Error("Expected variants");
  assert.equal(request.anyOf.length, 14);
  for (const candidate of [
    { model: "coda", voice: "custom", text: "Hello", language: "fr", timestampGranularity: "word" },
    { model: "mist-v3", voice: "custom", text: "Hello", language: "es", textMarkup: { phonemes: true } },
    { model: "mist-v2", voice: "custom", text: "Hello", output: { format: "ogg_opus" } },
  ]) assert.throws(() => validateRequest(candidate), { name: "TypeError", message: "Invalid rime TTS request" });
});
