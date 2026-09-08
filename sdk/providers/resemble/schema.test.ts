import { expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest } from "./index.ts";
import { validateRequest } from "../../generated/validators/resemble.ts";

test("Resemble uses a provider model union over the flat base", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const requests: TtsRequest[] = [
    { text: "Hello", styleExaggeration: 2, temperature: 5, referenceAudioTrimming: true },
    { text: "你好", model: "chatterbox-multilingual", language: "zh", referenceAudio: Uint8Array.of(1) },
    { text: "[laugh] Hello", model: "chatterbox-turbo", minP: 0, topP: 0, topK: 0, loudnessNormalization: false },
  ];
  for (const request of requests) expect(() => validateRequest(request)).not.toThrow();
  // @ts-expect-error These deployed models do not consume incremental text.
  const stream: TtsRequest = { text: (async function* () { yield "Hello"; })() };
  // @ts-expect-error Turbo exposes no CFG control.
  const guidance: TtsRequest = { model: "chatterbox-turbo", text: "Hello", voiceGuidance: 0.5 };
  // @ts-expect-error Sampling filters belong to Turbo, not base Chatterbox.
  const filters: TtsRequest = { model: "chatterbox", text: "Hello", topK: 3 };
  // @ts-expect-error Trimming is exposed only in the base deployment.
  const trimming: TtsRequest = { model: "chatterbox-multilingual", text: "Hello", referenceAudioTrimming: true };
  // @ts-expect-error English-only Turbo has no locale parameter.
  const language: TtsRequest = { model: "chatterbox-turbo", text: "Hello", language: "en" };
  // @ts-expect-error Reference conditioning is not saved voice selection.
  const voice: TtsRequest = { text: "Hello", voice: "saved-id" };
  // @ts-expect-error Gradio returns the generated WAV with no output resampling API.
  const output: TtsRequest = { text: "Hello", output: { format: "wav", sampleRateHz: 24000 } };
  void [stream, guidance, filters, trimming, language, voice, output];
});
test.each([
  { text: "😀".repeat(301) }, { temperature: 5.1 }, { temperature: 0.04 }, { styleExaggeration: 2.1 }, { voiceGuidance: 0.1 },
  { topP: 0.9 }, { voice: "saved" }, { language: "en" }, { timestampGranularity: "word" }, { speed: 1 },
  { model: "chatterbox-turbo", styleExaggeration: 1 }, { model: "chatterbox-turbo", temperature: 2.1 },
  { model: "chatterbox-turbo", minP: -0.1 }, { model: "chatterbox-turbo", topK: 1001 },
  { model: "chatterbox-turbo", repetitionPenalty: 0.9 }, { model: "chatterbox-turbo", topP: 1.1 },
  { model: "chatterbox-multilingual", language: "auto" }, { model: "chatterbox-multilingual", referenceAudioTrimming: false },
  { referenceAudio: "https://example.invalid/audio.wav" }, { output: { format: "mp3" } }, { output: { format: "wav", bitRateBps: 128000 } },
] as const)("Resemble schema rejects unsupported external request %#", fields => {
  expect(() => validateRequest({ text: "Hello", ...fields })).toThrow(TypeError);
});
test("Resemble maxLength is Unicode code points, not UTF-16 units", () => {
  expect(() => validateRequest({ text: "😀".repeat(300) })).not.toThrow();
});
