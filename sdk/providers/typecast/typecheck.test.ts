import { expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest, TtsSegment } from "./index.ts";

test("Typecast request and segment variants enforce model capabilities without widening the base", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const modern = { model: "ssfm-v30", voice: "uc_custom", text: "Hello", emotion: "auto", contextBefore: { text: "Before" }, language: "hi" } as const satisfies TtsRequest;
  const composed: TtsRequest = { segments: [{ kind: "speech", ...modern }, { kind: "pause", pauseMs: 100 }] };
  // @ts-expect-error V21 has no Smart Emotion.
  const oldSmart: TtsRequest = { model: "ssfm-v21", voice: "tc_voice", text: "Hello", emotion: "auto" };
  // @ts-expect-error Hindi is V30-only.
  const oldLanguage: TtsRequest = { model: "ssfm-v21", voice: "tc_voice", text: "Hello", language: "hi" };
  // @ts-expect-error Context and preset emotion are not one native prompt mode.
  const mixed: TtsRequest = { model: "ssfm-v30", voice: "tc_voice", text: "Hello", emotion: "happy", contextBefore: { text: "Before" } };
  // @ts-expect-error Relative scaling and absolute loudness are mutually exclusive.
  const gain: TtsRequest = { model: "ssfm-v30", voice: "tc_voice", text: "Hello", volumeScale: 1, targetLoudnessLufs: -14 };
  // @ts-expect-error Timestamp WAV is 44.1 kHz, not the stream's 32 kHz.
  const timed: TtsRequest = { model: "ssfm-v30", voice: "tc_voice", text: "Hello", timestampGranularity: "word", output: { format: "wav", sampleRateHz: 32000 } };
  // @ts-expect-error Native streaming output still takes whole input text only.
  const streaming: TtsRequest = { model: "ssfm-v30", voice: "tc_voice", text: (async function* () { yield "Hello"; })() };
  // @ts-expect-error Speech segments do not choose separate formats.
  const format: TtsSegment = { kind: "speech", model: "ssfm-v30", voice: "tc_voice", text: "Hello", output: { format: "mp3" } };
  // @ts-expect-error A pause cannot also contain speech.
  const pause: TtsSegment = { kind: "pause", pauseMs: 100, text: "Hello" };
  void [modern, composed, oldSmart, oldLanguage, mixed, gain, timed, streaming, format, pause];
});
