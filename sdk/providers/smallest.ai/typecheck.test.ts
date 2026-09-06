import { expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest as AmazonRequest } from "../../../schemas/providers/amazon/index.ts";
import type { TtsRequest, TtsInput } from "./index.ts";

test("Smallest models, timestamp voices and buffering modes narrow without widening Amazon", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const pro: TtsRequest = { model: "lightning-v3.1-pro", text: "こんにちは", voice: "custom", language: "ja", formulaReading: false };
  const timed: TtsRequest = { model: "lightning-v3.1", text: "Hi", voice: "meher", timestampGranularity: "word" };
  // @ts-expect-error Retired model, not a live capability.
  const retired: TtsRequest = { model: "lightning-v2", text: "Hi", voice: "custom" };
  // @ts-expect-error Japanese is Pro-only.
  const standard: TtsRequest = { model: "lightning-v3.1", text: "Hi", voice: "custom", language: "ja" };
  // @ts-expect-error An arbitrary clone has no documented aligner checkpoint.
  const cloneTiming: TtsRequest = { model: "lightning-v3.1", text: "Hi", voice: "custom", timestampGranularity: "word" };
  // @ts-expect-error Automatic routing may leave the aligned English/Hindi families.
  const autoTiming: TtsRequest = { model: "lightning-v3.1-pro", text: "Hi", voice: "meher", timestampGranularity: "word", language: "auto" };
  const text = (async function* (): AsyncGenerator<TtsInput> { yield "Hi"; yield { command: "clear" }; })();
  const continued: TtsRequest = { model: "lightning-v3.1-pro", voice: "custom", text, continuation: { id: "context" } };
  // @ts-expect-error Legacy buffering cannot be mixed with continuations.
  const mixed: TtsRequest = { model: "lightning-v3.1", voice: "custom", text, continuation: { id: "context" }, maxBufferDelayMs: 0 };
  // @ts-expect-error Clear is supported only in the documented continuation protocol.
  const legacyClear: TtsRequest = { model: "lightning-v3.1", voice: "custom", text };
  // @ts-expect-error Amazon remains string-only.
  const amazon: AmazonRequest = { model: "generative", voice: "Joanna", output: { format: "mp3" }, text };
  void [pro, timed, retired, standard, cloneTiming, autoTiming, continued, mixed, legacyClear, amazon];
});
