import { expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest as AmazonRequest } from "../../../schemas/providers/amazon/index.ts";
import type { TtsRequest, TtsInput } from "./index.ts";

test("model and language narrow the provider API without widening Amazon streams", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const coda: TtsRequest = { model: "coda", text: "Hi", voice: "custom", language: "it", output: { format: "webm_opus" } };
  const english: TtsRequest = { model: "mist-v3", text: "Hi", voice: "custom", textMarkup: { phonemes: true, speeds: [2] }, timestampGranularity: "word" };
  const legacy: TtsRequest = { model: "mist-v2", text: "Hi", voice: "custom", textNormalization: false, output: { format: "mulaw", sampleRateHz: 8000 } };
  // @ts-expect-error Coda has no inline phoneme switch.
  const badCoda: TtsRequest = { model: "coda", text: "Hi", voice: "custom", textMarkup: { phonemes: true } };
  // @ts-expect-error Mist v3 phonemes are English-only, even when explicitly disabled.
  const badLanguage: TtsRequest = { model: "mist-v3", language: "es", text: "Hi", voice: "custom", textMarkup: { phonemes: false } };
  // @ts-expect-error Timestamps are not emitted for French.
  const badTiming: TtsRequest = { model: "mist-v2", language: "fr", text: "Hi", voice: "custom", timestampGranularity: "word" };
  // @ts-expect-error Mist v2's preferred streaming transports do not expose WAV.
  const badFormat: TtsRequest = { model: "mist-v2", text: "Hi", voice: "custom", output: { format: "wav" } };
  const text = (async function* (): AsyncGenerator<TtsInput> { yield "Hi"; yield { command: "clear" }; yield { command: "flush" }; })();
  const incremental: TtsRequest = { model: "coda", voice: "custom", text, segmentation: "manual" };
  // @ts-expect-error Amazon remains string-only: Rime commands are not valid input.
  const amazon: AmazonRequest = { model: "generative", voice: "Joanna", output: { format: "mp3" }, text };
  void [coda, english, legacy, badCoda, badLanguage, badTiming, badFormat, incremental, amazon];
});
