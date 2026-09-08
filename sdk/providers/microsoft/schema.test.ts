import { expect, expectTypeOf, test } from "bun:test";
import assert from "node:assert/strict";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest } from "../../../schemas/providers/microsoft/index.ts";
import { validateRequest } from "../../generated/validators/microsoft.ts";

async function* text() { yield "Hello"; }

test("Microsoft model and input variants remain subsets of the shared request", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const valid = [
    { text: "Hello", voice: "en-US-AvaNeural", speed: 1.5 },
    { text: "Hello", voice: "en-US-Ava", model: "dragon-hd", temperature: 0 },
    { text: "Hello", voice: "en-US-Ava", model: "dragon-hd-omni", topP: 0.8, topK: 20, voiceGuidance: 1.2, timestampGranularity: "word" },
    { text: text(), voice: "en-US-Ava", model: "dragon-hd-omni", temperature: 0.7, timestampGranularity: "word" },
    { text: "Hello", voice: "en-US-Harper", model: "mai-voice-2", emotion: "happy" },
    { text: "Hello", voice: "en-US-Harper", model: "mai-voice-2-flash" },
    { inputType: "ssml", text: "<speak/>", timestampGranularity: ["word", "ssml", "viseme", "sentence"] },
  ] satisfies readonly TtsRequest[];
  for (const request of valid) expect(typeof validateRequest(request)).toBe("function");
});

test.each([
  { text: "Hello", voice: "en-US-Ava", model: "dragon-hd", speed: 1.5 },
  { text: "Hello", voice: "en-US-Ava", model: "dragon-hd", timestampGranularity: "word" },
  { text: "Hello", voice: "en-US-Ava", model: "dragon-hd-omni", temperature: 0.2 },
  { text: "Hello", voice: "en-US-Ava", model: "dragon-hd-omni", topK: 20.5 },
  { text: text(), voice: "en-US-Ava", model: "dragon-hd-omni", topK: 20 },
  { text: text(), voice: "en-US-AvaNeural", output: { format: "wav", sampleRateHz: 24000 } },
  { text: "Hello", voice: "en-US-AvaNeural", timestampGranularity: "word", output: { format: "wav", sampleRateHz: 24000 } },
  { text: "Hello", voice: "en-US-AvaNeural", output: { format: "mp3", sampleRateHz: 16000, bitRateBps: 160000 } },
  { text: "Hello", voice: "en-US-AvaNeural", output: { format: "pcm", sampleRateHz: 24000, sampleEncoding: "float_32" } },
  { text: "Hello", voice: "en-US-AvaNeural", output: { format: "wav", sampleRateHz: 24000, sampleEncoding: "alaw" } },
  { inputType: "ssml", text: text() },
  { inputType: "ssml", text: "<speak/>", model: "neural" },
  { text: "Hello", voice: "en-US-Ava:DragonHDLatestNeural", model: "neural" },
  { text: "Hello", voice: "en-US-AvaNeural", speed: NaN },
  { text: "Hello", voice: "en-US-AvaNeural", volumeDb: 3 },
  { text: "Hello", voice: "en-US-AvaNeural", volumeScale: 1.1 },
  { text: "Hello", voice: "en-US-AvaNeural", pitchSemitones: -13 },
  { text: "Hello", voice: "en-US-AvaNeural", pitchSemitones: 8 },
  { text: "Hello", voice: "en-US-Tiana", model: "dragon-hd-flash", language: "fr-FR" },
])("Microsoft schema rejects invalid combination %#", request => {
  assert.throws(() => validateRequest(request), TypeError);
});

test("Microsoft streaming input stays string-only", () => {
  const check = validateRequest({ text: text(), voice: "en-US-AvaNeural" });
  expect(check("Hello")).toBeUndefined();
  let failure: unknown; try { check({ command: "clear" }); } catch (error) { failure = error; }
  expect(failure).toEqual(new TypeError("Invalid microsoft TTS input item:\ntext item: expected string"));
});

// These assignments must fail in TypeScript, before generated runtime checks.
// @ts-expect-error HD models do not support neural prosody.
const badHd: TtsRequest = { text: "Hello", voice: "en-US-Ava", model: "dragon-hd", speed: 1.5 };
// @ts-expect-error Streaming Omni cannot send static SSML tuning parameters.
const badStreaming: TtsRequest = { text: text(), voice: "en-US-Ava", model: "dragon-hd-omni", topK: 20 };
// @ts-expect-error SSML is a whole document, not incremental text pieces.
const badSsml: TtsRequest = { inputType: "ssml", text: text() };
void [badHd, badStreaming, badSsml];
