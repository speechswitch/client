import { expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest } from "./index.ts";
import { validateRequest } from "../../generated/validators/openai.ts";

test("OpenAI model unions narrow the flat base without leaking mini capabilities to legacy models", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const requests: TtsRequest[] = [
    { text: "Hi", voice: "alloy" }, { text: "Hi", model: "tts-1-hd", voice: "sage" },
    { text: "Hi", model: "gpt-4o-mini-tts", voice: "cedar", instructions: "Whisper", includeUsage: true },
    { text: "Hi", model: "gpt-4o-mini-tts-2025-03-20", voice: "saved", voiceSource: "custom" },
  ];
  for (const request of requests) expect(() => validateRequest(request)).not.toThrow();
  // @ts-expect-error Legacy models cannot accept acting instructions.
  const instructions: TtsRequest = { text: "Hi", voice: "alloy", model: "tts-1-hd", instructions: "Whisper" };
  // @ts-expect-error Usage requires SSE, which legacy models do not support.
  const usage: TtsRequest = { text: "Hi", voice: "alloy", includeUsage: true };
  // @ts-expect-error Cedar is not a legacy voice.
  const voice: TtsRequest = { text: "Hi", model: "tts-1", voice: "cedar" };
  // @ts-expect-error Arbitrary voice IDs require explicit custom selection.
  const custom: TtsRequest = { text: "Hi", model: "gpt-4o-mini-tts", voice: "saved" };
  // @ts-expect-error Custom voices do not belong to legacy models.
  const legacyCustom: TtsRequest = { text: "Hi", voice: "saved", voiceSource: "custom" };
  // @ts-expect-error The Speech endpoint only accepts whole text.
  const stream: TtsRequest = { text: (async function* () { yield "Hi"; })(), voice: "alloy" };
  // @ts-expect-error PCM has a fixed native sample rate.
  const rate: TtsRequest = { text: "Hi", voice: "alloy", output: { format: "pcm", sampleRateHz: 48000 } };
  // @ts-expect-error Speech synthesis selects existing voices, not reference audio.
  const reference: TtsRequest = { text: "Hi", voice: "alloy", referenceAudio: Uint8Array.of(1) };
  void [instructions, usage, voice, custom, legacyCustom, stream, rate, reference];
});
test.each([
  { model: "unknown" }, { model: "tts-1", instructions: "Whisper" }, { includeUsage: false }, { voice: "cedar" },
  { model: "gpt-4o-mini-tts", voice: "saved" }, { voiceSource: "custom" }, { language: "en" },
  { timestampGranularity: "word" }, { referenceAudio: Uint8Array.of(1) }, { speed: 0.24 }, { speed: 4.01 }, { speed: NaN },
  { text: "😀".repeat(4097) }, { model: "gpt-4o-mini-tts", instructions: "a".repeat(4097) },
  { output: { format: "pcm", sampleRateHz: 48000 } }, { output: { format: "pcm", sampleEncoding: "float_32" } },
  { output: { format: "pcm", byteOrder: "big_endian" } }, { output: { format: "pcm", channelCount: 2 } },
  { output: { format: "mp3", sampleRateHz: 24000 } }, { output: { format: "ogg_opus" } },
] as const)("OpenAI generated validation rejects invalid external data %#", fields => {
  expect(() => validateRequest({ text: "Hi", voice: "alloy", ...fields })).toThrow(TypeError);
});
test("OpenAI generated length validation counts Unicode code points, including optional instructions", () => {
  expect(() => validateRequest({ model: "gpt-4o-mini-tts", text: "😀".repeat(4096), voice: "alloy", instructions: "😀".repeat(4096) })).not.toThrow();
});
