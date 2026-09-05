import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { changeSchemaField, materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";

const provider = providerSchemasFromSpeechSpec(extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname))
  .find(({ id }) => id === "deepdub")!;
const request = { model: "og-1.1", voice: "custom", text: "hello", language: "en-US", output: { format: "mp3" } };

test("Deepdub playground derives model-specific seed visibility from the provider union", () => {
  const sharedFields = [
    "referenceAudio", "targetDurationMs", "accentBlend", "audioEnhancement", "automaticGainControl",
    "deliveryReference", "deliveryVariance", "durationStretching", "language", "output", "processingPriority",
    "speakerGender", "speed", "temperature", "text", "voice", "voiceBoost",
  ];
  assert.deepEqual(objectFields(provider.request, request).map(({ name }) => name), ["model", "randomSeed", ...sharedFields]);
  assert.deepEqual(objectFields(provider.request, { ...request, model: "lightning-2.5" }).map(({ name }) => name), ["model", ...sharedFields]);
  assert.deepEqual(objectFields(provider.request, { ...request, model: "phantom-x-3.2" }).map(({ name }) => name), ["model", ...sharedFields]);
  assert.equal(provider.streamingText, undefined);
});

test("Deepdub model changes drop an unsupported seed while preserving compatible options", () => {
  assert.deepEqual(changeSchemaField(provider.request, { ...request, randomSeed: 42, speed: 1.2 }, "model", "phantom-x-3.2"),
    { ...request, model: "phantom-x-3.2", speed: 1.2 });
  assert.throws(() => materializedRequest(provider, { ...request, model: "phantom-x-3.2", randomSeed: 42 }),
    { name: "TypeError", message: "request: randomSeed is not supported by this variant" });
});

test("Deepdub duration selection removes speed without changing the chosen model or voice", () => {
  assert.deepEqual(changeSchemaField(provider.request, { ...request, speed: 1.2 }, "targetDurationMs", 1500),
    { ...request, targetDurationMs: 1500 });
  assert.deepEqual(materializedRequest(provider, { ...request, randomSeed: 42, targetDurationMs: 1500 }),
    { ...request, randomSeed: 42, targetDurationMs: 1500 });
});
