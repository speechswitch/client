import assert from "node:assert/strict";
import { expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest } from "./index.ts";
import { validateRequest } from "../../generated/validators/murf.ts";

const text = (async function* () { yield "Hello"; })();
test("Murf generated static text bounds count UTF-16 units in every model variant", () => {
  for (const fields of [{}, { model: "gen2" }, { model: "gen2", timestampText: "original", timestampGranularity: "word", language: "en-US" }]) {
    for (const text of ["x".repeat(3000), "🚀".repeat(1500), "line\n".repeat(600)]) {
      expect(() => validateRequest({ voice: "v", text, ...fields })).not.toThrow();
    }
    for (const text of ["x".repeat(3001), "🚀".repeat(1501)]) {
      assert.throws(() => validateRequest({ voice: "v", text, ...fields }), { name: "TypeError", message: "Invalid murf TTS request" });
    }
  }
});
test("Murf plain provider request narrows the base and separates model capabilities", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const requests: TtsRequest[] = [{ text, voice: "Gordon" }, { text: "Hi", voice: "voice", model: "gen2", targetDurationMs: 0, deliveryVariance: 0.2 },
    { text: "Hi", voice: "voice", model: "gen2", language: "en-US", timestampText: "original", timestampGranularity: "word" }];
  for (const request of requests) expect(() => validateRequest(request)).not.toThrow();
  // @ts-expect-error Gen2 streaming was deprecated; use Falcon 2 for incremental input.
  const gen2: TtsRequest = { text, voice: "voice", model: "gen2" };
  // @ts-expect-error Falcon has no documented duration constraint.
  const falcon: TtsRequest = { text: "Hi", voice: "voice", targetDurationMs: 1 };
  // @ts-expect-error Original alignment requires explicit English locale and word timing.
  const original: TtsRequest = { text: "Hi", voice: "voice", model: "gen2", timestampText: "original" };
  // @ts-expect-error Discrete native variation must remain representable without rounding.
  const variation: TtsRequest = { text: "Hi", voice: "voice", model: "gen2", deliveryVariance: 0.3 };
  // @ts-expect-error Generation endpoint does not advertise 16kHz.
  const rate: TtsRequest = { text: "Hi", voice: "voice", model: "gen2", output: { format: "pcm", sampleRateHz: 16000 } };
  void [gen2, falcon, original, variation, rate];
});
test.each([
  { model: "falcon" }, { model: "gen-2" }, { model: "gen2", text }, { deliveryVariance: 0 }, { targetDurationMs: 1000 },
  { timestampGranularity: "word" }, { textBufferThreshold: 40 }, { speed: 1 }, { referenceAudio: Uint8Array.of(1) },
  { model: "gen2", timestampGranularity: "word", timestampText: "original", language: "fr-FR" },
  { model: "gen2", targetDurationMs: -1 }, { speedBias: 51 }, { pitchBias: -51 },
  { output: { format: "ogg_opus" } }, { output: { format: "pcm", sampleRateHz: 22050 } },
  { text, textBufferThreshold: 39 }, { text, maxBufferDelayMs: 1001 },
] as const)("Murf generated validator rejects unsupported external request %#", fields => {
  expect(() => validateRequest({ text: "Hello", voice: "voice", ...fields })).toThrow(new TypeError("Invalid murf TTS request"));
});
test("Murf generated incremental checks retain update bounds and reject missing commands", () => {
  const validate = validateRequest({ voice: "voice", text });
  for (const item of ["", { command: "clear" }, { command: "flush" }, { command: "update", speedBias: 0, maxBufferDelayMs: 0 }]) expect(() => validate(item)).not.toThrow();
  for (const item of [undefined, { command: "invalid" }, { command: "update", speedBias: 51 }, { command: "update", replacements: [] }]) expect(() => validate(item)).toThrow(new TypeError("Invalid murf TTS input item"));
});

test.each([
  ["speedBias", -50, 50, 0.5],
  ["pitchBias", -50, 50, -0.5],
  ["textBufferThreshold", 40, 160, 40.5],
  ["maxBufferDelayMs", 0, 1000, 0.5],
] as const)("Murf schema owns integer validation for %s in requests and updates", (field, minimum, maximum, fraction) => {
  const validateInput = validateRequest({ voice: "voice", text });
  for (const value of [minimum, maximum]) {
    expect(() => validateRequest({ voice: "voice", text, [field]: value })).not.toThrow();
    expect(() => validateInput({ command: "update", [field]: value })).not.toThrow();
  }
  for (const value of [fraction, minimum - 1, maximum + 1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateRequest({ voice: "voice", text, [field]: value }), { name: "TypeError", message: "Invalid murf TTS request" });
    assert.throws(() => validateInput({ command: "update", [field]: value }), { name: "TypeError", message: "Invalid murf TTS input item" });
  }
});

test.each([
  { text: "Hello", voice: "voice" },
  { text: "Hello", voice: "voice", model: "gen2" },
  { text: "Hello", voice: "voice", model: "gen2", timestampText: "original", timestampGranularity: "word", language: "en-US" },
] as const)("Murf schema rejects fractional voice settings in HTTP variant %#", request => {
  for (const field of ["speedBias", "pitchBias"] as const) {
    expect(() => validateRequest({ ...request, [field]: 0 })).not.toThrow();
    assert.throws(() => validateRequest({ ...request, [field]: 0.5 }), { name: "TypeError", message: "Invalid murf TTS request" });
  }
});
