import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/voice.ai.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "voice.ai")!;

test("Voice.ai playground defaults to language-based model routing without losing zero settings", () => {
  const request = materializedRequest(provider, { text: "Hello", temperature: 0, topP: 0 });
  assert.deepEqual(request, { text: "Hello", temperature: 0, topP: 0, apiVersion: "v1", audioDelivery: "immediate", model: "auto", language: "en" });
  validateRequest(request);
});

test("Voice.ai playground narrows paced Lite output and fills only documented defaults", () => {
  const request = materializedRequest(provider, { text: "Hello", model: "voiceai-tts-lite-v1-latest", audioDelivery: "paced", output: { format: "pcm" } });
  assert.deepEqual(request, { text: "Hello", model: "voiceai-tts-lite-v1-latest", apiVersion: "v1", audioDelivery: "paced", language: "en", temperature: 1, topP: 0.8,
    output: { format: "pcm", sampleRateHz: 32000, sampleEncoding: "signed_integer_16", byteOrder: "little_endian", channelCount: 1 } });
  validateRequest(request);
});

test("legacy playground does not import current model, language or PCM defaults", () => {
  const input = { apiVersion: "tts-v2", voice: "owned", text: "Hello", output: { format: "pcm" } };
  assert.deepEqual(materializedRequest(provider, input), input);
  validateRequest(input);
});

test("Voice.ai schema graph owns nine model/API/cadence variants", () => {
  const request = spec.tts.providers.find(value => value.id === "voice.ai")!.request;
  assert.equal(request.kind, "union"); if (request.kind !== "union") throw new Error("Expected variants");
  assert.equal(request.anyOf.length, 9);
  const modern = request.anyOf.find(type => type.kind === "object" && type.fields.some(field => field.name === "pronunciationDictionaries"));
  assert.equal(modern?.kind, "object"); if (modern?.kind !== "object") throw new Error("Expected modern request");
  assert.deepEqual(modern.fields.find(field => field.name === "pronunciationDictionaries")?.constraints, { minItems: 1, maxItems: 1 });
});
