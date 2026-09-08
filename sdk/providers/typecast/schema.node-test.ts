import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/typecast.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "typecast")!;
test("Typecast playground materializes the correct model, emotion and endpoint-specific output defaults", () => {
  const stream = materializedRequest(provider, { model: "ssfm-v21", voice: "tc_voice", text: "Hello", output: { format: "wav" } });
  assert.deepEqual(stream, { model: "ssfm-v21", voice: "tc_voice", text: "Hello", language: "auto", emotion: "normal", emotionIntensity: 1, speed: 1, pitchSemitones: 0,
    output: { format: "wav", sampleRateHz: 32000, sampleEncoding: "signed_integer_16", byteOrder: "little_endian", channelCount: 1 } });
  validateRequest(stream);
  const timed = materializedRequest(provider, { model: "ssfm-v30", voice: "uc_voice", text: "Hello", emotion: "auto", timestampGranularity: "character", output: { format: "wav" } });
  assert.deepEqual(timed, { model: "ssfm-v30", voice: "uc_voice", text: "Hello", language: "auto", emotion: "auto", speed: 1, pitchSemitones: 0, timestampGranularity: "character",
    output: { format: "wav", sampleRateHz: 44100, sampleEncoding: "signed_integer_16", byteOrder: "little_endian", channelCount: 1 } });
  validateRequest(timed);
  const compose = materializedRequest(provider, { output: { format: "mp3" }, segments: [{ kind: "speech", model: "ssfm-v30", voice: "tc_voice", text: "Hello" }, { kind: "pause", pauseMs: 100 }] });
  assert.deepEqual(compose, { output: { format: "mp3", sampleRateHz: 44100, bitRateBps: 320000 },
    segments: [{ kind: "speech", model: "ssfm-v30", voice: "tc_voice", text: "Hello", language: "auto", emotion: "normal", emotionIntensity: 1, speed: 1, pitchSemitones: 0 }, { kind: "pause", pauseMs: 100 }] });
  validateRequest(compose);
});

test("Typecast normalized graph retains model unions and generated array bounds", () => {
  const request = spec.tts.providers.find(value => value.id === "typecast")!.request;
  assert.equal(request.kind, "union"); if (request.kind !== "union") throw new Error("Expected variants");
  assert.equal(request.anyOf.length, 10);
  const composed = request.anyOf.find(type => type.kind === "object" && type.fields.some(field => field.name === "segments"));
  assert.equal(composed?.kind, "object"); if (composed?.kind !== "object") throw new Error("Expected composition");
  assert.deepEqual(composed.fields.find(field => field.name === "segments")?.constraints, { minItems: 1, maxItems: 50 });
});
