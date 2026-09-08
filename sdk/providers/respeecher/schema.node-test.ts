import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/respeecher.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "respeecher")!;
test("Respeecher playground preserves native voice defaults and selected audio representation", () => {
  const request = materializedRequest(provider, { voice: "custom", text: "Hello" });
  assert.deepEqual(request, { voice: "custom", text: "Hello", model: "realtime-tts", language: "en" });
  validateRequest(request);
  const wave = materializedRequest(provider, { voice: "custom", text: "Hello", language: "uk", output: { format: "wav" } });
  assert.deepEqual(wave, { voice: "custom", text: "Hello", language: "uk", model: "realtime-tts", output: { format: "wav", sampleRateHz: 22050 } });
  validateRequest(wave);
  const pcm = materializedRequest(provider, { voice: "custom", text: "Hello", topK: 0, presencePenalty: 0, output: { format: "pcm" } });
  assert.deepEqual(pcm, { voice: "custom", text: "Hello", topK: 0, presencePenalty: 0, model: "realtime-tts", language: "en", output: { format: "pcm", sampleRateHz: 22050, sampleEncoding: "float_32" } });
  validateRequest(pcm);
});
