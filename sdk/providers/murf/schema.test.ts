import { expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest } from "./index.ts";
import { validateRequest } from "../../generated/validators/murf.ts";

const text = (async function* () { yield "Hello"; })();
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
