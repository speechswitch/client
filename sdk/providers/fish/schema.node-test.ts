import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { changeSchemaField, materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";

const provider = providerSchemasFromSpeechSpec(extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname)).find(({ id }) => id === "fish")!;
const common = { model: "s2-pro", voice: "custom", text: "hello", output: { format: "mp3" } };
const defaults = { conditionOnPreviousChunks: true, earlyStopThreshold: 1, latencyOptimization: "none", maxAudioTokens: 1024, minTextChunkLength: 50, repetitionPenalty: 1.2, speed: 1, temperature: 0.7, textChunkLength: 300, textNormalization: true, topP: 0.7, volumeDb: 0 };
const s1Fields = ["model", "referenceSamples", "conditionOnPreviousChunks", "earlyStopThreshold", "features", "latencyOptimization", "maxAudioTokens", "minTextChunkLength", "output", "repetitionPenalty", "speed", "temperature", "text", "textChunkLength", "textNormalization", "timestampGranularity", "topP", "voice", "volumeDb"];
const s2Fields = ["model", "speakers", "referenceSamples", "conditionOnPreviousChunks", "earlyStopThreshold", "features", "latencyOptimization", "loudnessNormalization", "maxAudioTokens", "minTextChunkLength", "output", "repetitionPenalty", "speed", "temperature", "text", "textChunkLength", "textNormalization", "timestampGranularity", "topP", "voice", "volumeDb"];

test("Fish model selector shows all current models with their own capabilities", () => {
  assert.deepEqual(objectFields(provider.request, { model: "s1" }).map(({ name }) => name), s1Fields);
  for (const model of ["s2-pro", "s2.1-pro", "s2.1-pro-free"]) {
    assert.deepEqual(objectFields(provider.request, { model }).map(({ name }) => name), s2Fields);
  }
  assert.deepEqual(objectFields(provider.streamingText!.request, { model: "s2-pro" }).map(({ name }) => name), s2Fields.filter(name => name !== "timestampGranularity"));
});

test("Fish model change removes unsupported loudness but preserves the custom voice", () => {
  assert.deepEqual(changeSchemaField(provider.request, { ...common, loudnessNormalization: false, volumeDb: -3 }, "model", "s1"),
    { ...defaults, ...common, model: "s1", volumeDb: -3 });
  assert.throws(() => materializedRequest(provider, { ...common, model: "s1", loudnessNormalization: false }),
    { name: "TypeError", message: "request: loudnessNormalization is not supported by this variant" });
});

test("Fish multi-speaker selection excludes top-level voice conditioning", () => {
  const dialogue = { model: "s2-pro", text: "<|speaker:0|>hello", output: common.output, speakers: [{ voice: "custom" }] };
  assert.deepEqual(materializedRequest(provider, dialogue), { ...defaults, ...dialogue, loudnessNormalization: true, output: { format: "mp3", bitRateBps: 128000 } });
  assert.throws(() => materializedRequest(provider, { ...dialogue, voice: "another" }),
    { name: "TypeError", message: "request: voice is not supported by this variant" });
});
