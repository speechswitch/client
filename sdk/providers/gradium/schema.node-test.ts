import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/gradium.ts";
import type { JsonValue } from "../../../playground/src/lib/provider-schema.ts";

const provider = providerSchemasFromSpeechSpec(extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname)).find(({ id }) => id === "gradium")!;
const fields = ["lexicon", "model", "output", "pacingBias", "temperature", "text", "textNormalization", "timestampGranularity", "voice", "voiceGuidance"];

test("Gradium models expose the same documented capabilities in both input modes", () => {
  for (const model of ["default", "gradium-tts-beta"]) for (const schema of [provider.request, provider.streamingText!.request]) {
    assert.deepEqual(objectFields(schema, { model }).map(field => field.name), fields);
    assert.deepEqual(objectFields(schema, { model }).find(field => field.name === "model")!.schema, { kind: "enum", values: ["default", "gradium-tts-beta"] });
  }
});

test("Gradium defaults preserve explicit zero and wider native tuning values", () => {
  const request = { voice: "custom", text: "Hello", output: { format: "pcm" }, temperature: 0, pacingBias: -5, voiceGuidance: 10 };
  const result = materializedRequest(provider, request);
  assert.deepEqual(result, { ...request, model: "default", output: { format: "pcm", sampleRateHz: 48000 } }); validateRequest(result);
});

test("Gradium normalization selectors remain cohesive and ordered", () => {
  const values: JsonValue[] = [false, "auto", { locale: "fr-ch" }, { rules: ["CurrencyFrCh", "UrlFr"] }];
  for (const textNormalization of values) {
    const request = { voice: "custom", text: "Hello", textNormalization, output: { format: "wav" } };
    const result = materializedRequest(provider, request);
    assert.deepEqual(result, { ...request, model: "default", pacingBias: 0, temperature: 0.7, voiceGuidance: 2 }); validateRequest(result);
  }
  assert.throws(() => materializedRequest(provider, { voice: "custom", text: "hi", output: { format: "wav", sampleRateHz: 24000 } }),
    { name: "TypeError", message: "request.output.sampleRateHz: Expected one of 48000" });
});
