import { expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest, TtsInput } from "./index.ts";
import { validateRequest } from "../../generated/validators/minimax.ts";

async function* input(): AsyncIterable<TtsInput> { yield "Hello"; yield { command: "clear" }; yield { command: "flush" }; }
test("MiniMax model, transport, and voice variants remain base subsets", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const requests = [
    { text: "Hello", voice: "existing-cloned-voice" },
    { text: "Hello", voice: "voice", model: "speech-2.6-hd", emotion: "whisper", language: "fa" },
    { text: "Hello", voice: "voice", model: "speech-02-turbo", language: "yue" },
    { text: "$$1+1$$", voice: "voice", formulaReading: "latex" },
    { text: "Hello", voiceBlend: [{ voice: "one", weight: 75 }, { voice: "two", weight: 100 }], output: { format: "flac" }, voiceTransform: { brightness: -10 } },
    { text: input(), voice: "voice", model: "speech-2.8-turbo", splitTurns: false, languageTextNormalization: true },
    { text: input(), voice: "voice", output: { format: "wav", sampleEncoding: "mulaw" } },
    { text: "Hello", voice: "voice", output: { format: "mp3", constantBitRate: true }, timestampGranularity: "word" },
  ] satisfies readonly TtsRequest[];
  for (const request of requests) expect(typeof validateRequest(request)).toBe("function");
});
test.each([
  { model: "speech-02-hd", language: "fa" },
  { model: "speech-2.8-hd", emotion: "whisper" },
  { formulaReading: "latex", language: "en" },
  { voiceBlend: [{ voice: "two", weight: 50 }] },
  { output: { format: "mulaw", sampleRateHz: 32000 } },
  { output: { format: "pcm", sampleEncoding: "signed_integer_16" } },
  { output: { format: "ogg_opus", bitRateBps: 64000 } },
  { text: "" }, { text: "x".repeat(10000) }, { voice: " " },
  { speed: 0.49 }, { volumeScale: 11 }, { pitchBias: 13 },
  { volumeScale: 0 }, { pitchBias: 0.5 },
  { voice: undefined, voiceBlend: [] },
  { voice: undefined, voiceBlend: Array.from({ length: 5 }, () => ({ voice: "voice", weight: 1 })) },
  { voice: undefined, voiceBlend: [{ voice: "voice", weight: 0.5 }] },
  { voiceTransform: { brightness: 0.5 } }, { voiceTransform: { softness: 0.5 } }, { voiceTransform: { crispness: 0.5 } },
  { voiceTransform: { brightness: 101 } }, { replacements: [{ pattern: "a/b", replacement: "c" }] },
  { languageTextNormalization: true },
  { text: input(), textNormalization: true },
  { text: input(), timestampGranularity: "word" },
  { text: input(), output: { format: "wav" } },
  { text: input(), output: { format: "mp3", constantBitRate: true } },
  { text: input(), output: { format: "flac" }, voiceTransform: {} },
  { text: input(), model: "speech-2.6-hd", splitTurns: true },
])("MiniMax generated validator rejects incompatible combination %# exactly", fields => {
  let failure: unknown;
  try { validateRequest({ voice: "voice", text: "Hello", ...fields }); } catch (error) { failure = error; }
  expect(failure).toEqual(new TypeError("Invalid minimax TTS request"));
});
test("MiniMax streaming validates only native clear and flush controls", () => {
  const validate = validateRequest({ voice: "voice", text: input() });
  for (const item of ["Hi", { command: "clear" }, { command: "flush" }]) expect(validate(item)).toBeUndefined();
  let failure: unknown; try { validate({ command: "update", replacements: [] }); } catch (error) { failure = error; }
  expect(failure).toEqual(new TypeError("Invalid minimax TTS input item"));
});
// @ts-expect-error 2.8 does not support 2.6-only whisper.
const emotion: TtsRequest = { text: "Hi", voice: "voice", model: "speech-2.8-hd", emotion: "whisper" };
// @ts-expect-error Voice blending replaces single voice selection.
const blend: TtsRequest = { text: "Hi", voice: "voice", voiceBlend: [{ voice: "two", weight: 1 }] };
// @ts-expect-error The bidirectional protocol does not define timestamp response payloads.
const timestamps: TtsRequest = { text: input(), voice: "voice", timestampGranularity: "word" };
// @ts-expect-error Chinese-only formula reading.
const language: TtsRequest = { text: "Hi", voice: "voice", formulaReading: "latex", language: "en" };
// @ts-expect-error WS effects are MP3-only.
const effects: TtsRequest = { text: input(), voice: "voice", voiceTransform: {}, output: { format: "flac" } };
void [emotion, blend, timestamps, language, effects];
