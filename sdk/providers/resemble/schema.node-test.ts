import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/resemble.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "resemble")!;
test("Resemble playground materializes model-specific defaults from the canonical schema", () => {
  const base = materializedRequest(provider, { text: "Hello", model: "chatterbox", output: { format: "wav" } });
  assert.deepEqual(base, { text: "Hello", model: "chatterbox", output: { format: "wav" }, temperature: 0.8, randomSeed: 0, voiceGuidance: 0.5, styleExaggeration: 0.5, referenceAudioTrimming: false });
  validateRequest(base);
  const multilingual = materializedRequest(provider, { text: "Hello", model: "chatterbox-multilingual" });
  assert.deepEqual(multilingual, { text: "Hello", model: "chatterbox-multilingual", language: "en", temperature: 0.8, randomSeed: 0, voiceGuidance: 0.5, styleExaggeration: 0.5 });
  validateRequest(multilingual);
  const turbo = materializedRequest(provider, { text: "[laugh] Hello", model: "chatterbox-turbo", minP: 0, topK: 0, loudnessNormalization: false });
  assert.deepEqual(turbo, { text: "[laugh] Hello", model: "chatterbox-turbo", minP: 0, topK: 0, loudnessNormalization: false, temperature: 0.8, randomSeed: 0, topP: 0.95, repetitionPenalty: 1.2 });
  validateRequest(turbo);
});
