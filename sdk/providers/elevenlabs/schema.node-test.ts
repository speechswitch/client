import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { changeSchemaField, materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";

const provider = providerSchemasFromSpeechSpec(extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname))
  .find(({ id }) => id === "elevenlabs")!;
const live = provider.streamingText!.request;
const request = { model: "flash-v2.5", voice: "custom", text: "Hello", output: { format: "mp3" } };

test("ElevenLabs playground shows controls for all four authored model variants", () => {
  const flash = ["model", "latencyOptimization", "timestampGranularity", "contextAfter", "contextBefore", "language", "languageTextNormalization", "output", "pronunciationDictionaries", "randomSeed", "speed", "stability", "styleExaggeration", "text", "textNormalization", "voice", "voiceBoost", "voiceSimilarity"];
  assert.deepEqual(objectFields(provider.request, { model: "flash-v2" }).map(({ name }) => name), flash);
  assert.deepEqual(objectFields(provider.request, request).map(({ name }) => name), flash);
  assert.deepEqual(objectFields(provider.request, { model: "multilingual-v2" }).map(({ name }) => name), flash.filter(name => name !== "language"));
  assert.deepEqual(objectFields(provider.request, { model: "eleven-v3" }).map(({ name }) => name),
    ["model", "latencyOptimization", "timestampGranularity", "contextAfter", "contextBefore", "language", "languageTextNormalization", "output", "pronunciationDictionaries", "randomSeed", "stability", "text", "textNormalization", "voice"]);
});

test("ElevenLabs model changes remove unsupported voice controls but retain the chosen custom voice", () => {
  assert.deepEqual(changeSchemaField(provider.request, { ...request, speed: 1.1, stability: 0.5, voiceSimilarity: 0.7, styleExaggeration: 0.1, voiceBoost: true, language: "fr" }, "model", "eleven-v3"),
    { ...request, model: "eleven-v3", stability: 0.5, language: "fr" });
  assert.deepEqual(changeSchemaField(provider.request, { ...request, speed: 1.1, language: "fr" }, "model", "multilingual-v2"),
    { ...request, model: "multilingual-v2", speed: 1.1 });
  assert.throws(() => materializedRequest(provider, { ...request, model: "eleven-v3", speed: 1.1 }),
    { name: "TypeError", message: "request: speed is not supported by this variant" });
});

test("ElevenLabs streaming buffering and timestamps remain independent selectors within a model", () => {
  const streaming = { ...request, text: [{ text: "Hello" }], textBufferThresholds: [50, 100], timestampGranularity: "character", timestampText: "normalized" };
  // The UI preserves serializable text segments separately from its string schema projection.
  const disabled = changeSchemaField(live, { ...streaming, text: "" }, "textBuffering", false);
  assert.deepEqual(disabled, { ...request, text: "", textBuffering: false, timestampGranularity: "character", timestampText: "normalized" });
  assert.deepEqual(materializedRequest(provider, streaming), streaming);
  assert.throws(() => materializedRequest(provider, { ...streaming, textBuffering: false }),
    { name: "TypeError", message: "request: textBufferThresholds is not supported by this variant" });
  assert.deepEqual(objectFields(live, { model: "eleven-v3" }).map(({ name }) => name),
    ["model", "timestampGranularity", "language", "output", "pronunciationDictionaries", "randomSeed", "stability", "text", "textNormalization", "voice"]);
  assert.deepEqual(objectFields(live, { model: "eleven-v3", timestampGranularity: "character" }).find(({ name }) => name === "timestampText")?.schema,
    { kind: "enum", values: ["original"] });
});

test("ElevenLabs MP3 sample rate changes select the matching bit rate", () => {
  const output = objectFields(provider.request, request).find(({ name }) => name === "output")!.schema;
  assert.deepEqual(changeSchemaField(output, { format: "mp3", sampleRateHz: 44100, bitRateBps: 128000 }, "sampleRateHz", 22050),
    { format: "mp3", sampleRateHz: 22050, bitRateBps: 32000 });
  assert.deepEqual(changeSchemaField(output, { format: "mp3", sampleRateHz: 22050, bitRateBps: 32000 }, "sampleRateHz", 24000),
    { format: "mp3", sampleRateHz: 24000, bitRateBps: 48000 });
});
