import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/smallest.ai.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "smallest.ai")!;
test("Smallest playground materializes the selected model, codec and alignment defaults", () => {
  const pro = materializedRequest(provider, { model: "lightning-v3.1-pro", voice: "custom", text: "Hello", language: "ja", output: { format: "pcm" } });
  assert.deepEqual(pro, { model: "lightning-v3.1-pro", voice: "custom", text: "Hello", language: "ja", speed: 1, formulaReading: false,
    output: { format: "pcm", sampleRateHz: 44100, sampleEncoding: "signed_integer_16", byteOrder: "little_endian", channelCount: 1 } });
  validateRequest(pro);
  const standard = materializedRequest(provider, { model: "lightning-v3.1", voice: "custom", text: "Hello" });
  assert.deepEqual(standard, { model: "lightning-v3.1", voice: "custom", text: "Hello", language: "auto", speed: 1, formulaReading: false });
  validateRequest(standard);
  const timed = materializedRequest(provider, { model: "lightning-v3.1-pro", voice: "meher", text: "Hello", timestampGranularity: "word" });
  assert.deepEqual(timed, { model: "lightning-v3.1-pro", voice: "meher", text: "Hello", timestampGranularity: "word", language: "en", speed: 1, formulaReading: false });
  validateRequest(timed);
});

test("normalized model graph retains twelve request variants and rejects invalid defaults/combinations", () => {
  const request = spec.tts.providers.find(value => value.id === "smallest.ai")!.request;
  assert.equal(request.kind, "union"); if (request.kind !== "union") throw new Error("Expected variants");
  assert.equal(request.anyOf.length, 12);
  for (const candidate of [
    { model: "lightning-v2", text: "Hi", voice: "custom" },
    { model: "lightning-v3.1", text: "Hi", voice: "custom", language: "ja" },
    { model: "lightning-v3.1-pro", text: "Hi", voice: "custom", timestampGranularity: "word" },
  ]) assert.throws(() => validateRequest(candidate), TypeError);
});
