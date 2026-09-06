import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/murf.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "murf")!;
test("Murf playground conditions rate defaults and Gen2-only variation by model", () => {
  const falcon = materializedRequest(provider, { text: "Hello", voice: "Gordon", model: "falcon-2", output: { format: "pcm" } });
  assert.deepEqual(falcon, { text: "Hello", voice: "Gordon", model: "falcon-2", speedBias: 0, pitchBias: 0, output: { format: "pcm", sampleRateHz: 24000, channelCount: 1 } });
  validateRequest(falcon);
  const gen2 = materializedRequest(provider, { text: "Hello", voice: "Natalie", model: "gen2", output: { format: "wav" } });
  assert.deepEqual(gen2, { text: "Hello", voice: "Natalie", model: "gen2", speedBias: 0, pitchBias: 0, deliveryVariance: 0.2, audioRetention: true, timestampText: "normalized", output: { format: "wav", sampleRateHz: 44100, channelCount: 1 } });
  validateRequest(gen2);
});
test("Murf playground preserves explicit original-text alignment instead of normalized defaults", () => {
  const request = materializedRequest(provider, { text: "Hello", voice: "Natalie", model: "gen2", language: "en-US", timestampGranularity: "word", timestampText: "original", audioRetention: false });
  assert.deepEqual(request, { text: "Hello", voice: "Natalie", model: "gen2", language: "en-US", timestampGranularity: "word", timestampText: "original", audioRetention: false, speedBias: 0, pitchBias: 0, deliveryVariance: 0.2 });
  validateRequest(request);
});
