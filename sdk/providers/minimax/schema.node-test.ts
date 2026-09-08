import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/minimax.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "minimax")!;
test("MiniMax playground defaults to 2.8 and automatic language", () => {
  const request = materializedRequest(provider, { text: "Hello", voice: "saved" });
  assert.deepEqual(request, { text: "Hello", voice: "saved", model: "speech-2.8-hd", language: "auto", pitchBias: 0, speed: 1, volumeScale: 1, textNormalization: false });
  validateRequest(request);
});
test("MiniMax formula reading materializes its Chinese default, not auto", () => {
  const request = materializedRequest(provider, { text: "$$1+1$$", voice: "saved", formulaReading: "latex" });
  assert.deepEqual(request, { text: "$$1+1$$", voice: "saved", formulaReading: "latex", model: "speech-2.8-hd", language: "zh", pitchBias: 0, speed: 1, volumeScale: 1, textNormalization: false });
  validateRequest(request);
});
test("MiniMax playground switches normalization and splitting fields by transport and model", () => {
  const relevant = (fields: ReturnType<typeof objectFields>) => fields.filter(field => ["textNormalization", "languageTextNormalization", "splitTurns"].includes(field.name)).map(field => [field.name, field.default]);
  assert.deepEqual(relevant(objectFields(provider.request, { model: "speech-2.8-hd" })), [["textNormalization", false]]);
  assert.deepEqual(relevant(objectFields(provider.streamingText!.request, { model: "speech-2.8-hd" })), [["languageTextNormalization", false], ["splitTurns", true]]);
  assert.deepEqual(relevant(objectFields(provider.streamingText!.request, { model: "speech-2.6-hd" })), [["languageTextNormalization", false]]);
});
test("MiniMax playground preserves voice blends without synthesizing a single voice field", () => {
  const request = materializedRequest(provider, { text: "Hello", voiceBlend: [{ voice: "one", weight: 75 }, { voice: "two", weight: 100 }] });
  assert.deepEqual(request, { text: "Hello", voiceBlend: [{ voice: "one", weight: 75 }, { voice: "two", weight: 100 }], model: "speech-2.8-hd", language: "auto", pitchBias: 0, speed: 1, volumeScale: 1, textNormalization: false });
  validateRequest(request);
});
