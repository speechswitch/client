import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { changeSchemaField, materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/google.ts";

const provider = providerSchemasFromSpeechSpec(extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname)).find(({ id }) => id === "google")!;
const common = { model: "gemini-2.5-flash-tts", language: "en-US", voice: "Kore", text: "hello", output: { format: "pcm" } };

test("Google model forms retain shared fields through overlapping transport variants", () => {
  assert.deepEqual(objectFields(provider.request, { model: "gemini-2.5-flash-lite-preview-tts" }).map(({ name }) => name),
    ["model", "effectsProfiles", "pitchSemitones", "volumeDb", "inputType", "instructions", "language", "output", "safetySettings", "speed", "text", "textNormalization", "voice"]);
  assert.deepEqual(objectFields(provider.request, { model: "gemini-2.5-flash-tts" }).map(({ name }) => name),
    ["model", "effectsProfiles", "pitchSemitones", "speakers", "volumeDb", "inputType", "instructions", "language", "output", "safetySettings", "speed", "text", "textNormalization", "voice"]);
  assert.deepEqual(objectFields(provider.request, { model: "chirp-3-hd" }).map(({ name }) => name),
    ["model", "effectsProfiles", "inputType", "language", "volumeDb", "output", "replacements", "speed", "text", "voice"]);
  assert.deepEqual(objectFields(provider.request, { model: "chirp-3-instant-custom-voice" }).map(({ name }) => name),
    ["model", "language", "inputType", "output", "replacements", "speed", "text", "voice"]);
});

test("Google dialogue forms materialize typed turns without a text field", () => {
  const request = { model: common.model, language: "en-US", speakers: [{ alias: "Sam", voice: "Kore" }, { alias: "Bob", voice: "Puck" }], turns: [{ speaker: "Sam", text: "Hello" }], output: { format: "wav" } };
  const resolved = materializedRequest(provider, request);
  assert.deepEqual(resolved, { ...request, speed: 1, textNormalization: true, output: { format: "wav", sampleEncoding: "signed_integer_16" } });
  validateRequest(resolved);
});

test("Google model changes remove incompatible controls but retain compatible voice and PCM output", () => {
  assert.deepEqual(changeSchemaField(provider.request, { ...common, instructions: "Happy", textNormalization: false }, "model", "chirp-3-hd"),
    { ...common, model: "chirp-3-hd", speed: 1 });
  assert.deepEqual(materializedRequest(provider, common), { ...common, speed: 1, textNormalization: true });
});

test("Google input-mode projection preserves output constraints and generated validation", () => {
  const stream = { ...common, text: ["hello"] };
  assert.deepEqual(materializedRequest(provider, stream), { ...stream, text: [{ text: "hello" }], speed: 1, textNormalization: true });
  const output = objectFields(provider.streamingText!.request, common).find(field => field.name === "output")!.schema;
  assert.equal(output.kind, "discriminatedUnion");
  assert.equal(output.discriminator, "format");
  assert.deepEqual(output.variants.flatMap(variant => variant.values), ["ogg_opus", "pcm", "alaw", "mulaw"]);
  assert.throws(() => materializedRequest(provider, { ...stream, output: { format: "wav" } }),
    { name: "TypeError", message: "request.output: Expected a valid format" });
});

test("factoring overlapping Google branches never invents SSML/raw G.711 combinations", () => {
  for (const format of ["wav", "pcm", "mp3", "ogg_opus", "alaw", "mulaw"]) {
    for (const inputType of ["text", "ssml", "markup"]) {
      const request = { ...common, model: "chirp-3-hd", inputType, output: { format } };
      if (inputType === "ssml" && (format === "alaw" || format === "mulaw")) {
        assert.throws(() => materializedRequest(provider, request), TypeError);
      } else validateRequest(materializedRequest(provider, request));
    }
  }
  for (const language of ["en-US", "bn-IN", "bg-BG"]) {
    const request = { ...common, model: "chirp-3-hd", language, inputType: "markup" };
    if (language === "bg-BG") assert.throws(() => materializedRequest(provider, request), TypeError);
    else validateRequest(materializedRequest(provider, request));
  }
});
