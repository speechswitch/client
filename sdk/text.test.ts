import { describe, expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest } from "../schemas/base.ts";
import { textChunks } from "./text.ts";

describe("normalized requests", () => {
  test("uses a plain request type", () => {
    expectTypeOf<TtsRequest>().toEqualTypeOf<{
      readonly text?: string | AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" } | {
        readonly command: "update";
        readonly replacements: readonly { readonly pattern: string; readonly replacement: string }[];
      }>;
      readonly voice?: string;
      readonly referenceAudio?: Uint8Array;
      readonly deliveryReference?: string;
      readonly inputType?: "text" | "ssml";
      readonly model?: string;
      readonly modelImprovementOptOut?: boolean;
      readonly tags?: readonly string[];
      readonly language?: string;
      readonly lexicon?: string | readonly string[];
      readonly output?: {
        readonly format: "mp3" | "ogg_vorbis" | "wav" | "pcm" | "ogg_opus" | "alaw" | "mulaw" | "flac" | "aac";
        readonly sampleRateHz?: number;
        readonly bitRateBps?: number;
        readonly sampleEncoding?: "signed_integer_16" | "signed_integer_32" | "float_32" | "mulaw" | "alaw";
        readonly byteOrder?: "little_endian" | "big_endian";
      };
      readonly speed?: number;
      readonly targetDurationMs?: number;
      readonly deliveryVariance?: number;
      readonly temperature?: number;
      readonly randomSeed?: number;
      readonly voiceBoost?: boolean;
      readonly durationStretching?: boolean;
      readonly processingPriority?: "standard" | "realtime";
      readonly automaticGainControl?: boolean;
      readonly speakerGender?: "male" | "female";
      readonly accentBlend?: { readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number };
      readonly timestampGranularity?: "character" | "word" | "phoneme" | readonly ("word" | "phoneme")[];
      readonly stability?: number;
      readonly volumeScale?: number;
      readonly emotion?: string;
      readonly accent?: string;
      readonly maxBufferDelayMs?: number;
      readonly timestampText?: "original" | "normalized";
      readonly audioEnhancement?: boolean;
      readonly namedEntityPronunciationEnhancement?: boolean;
      readonly referenceAudioEnhancement?: boolean;
      readonly accentPreservation?: boolean;
      readonly textFlushDelayMs?: number;
      readonly inferenceSteps?: number;
      readonly segmentation?: "sentence" | "immediate";
      readonly textNormalization?: boolean | { readonly locale: string };
      readonly replacements?: readonly {
        readonly pattern: string;
        readonly replacement: string;
      }[];
      readonly latencyOptimization?: "none" | "moderate" | "aggressive";
    }>();
  });

  test("iterates static and streaming input consistently", async () => {
    const streamed = async function* () {
      yield "one";
      yield "two";
    };
    expect(await Array.fromAsync(textChunks("one"))).toEqual(["one"]);
    expect(await Array.fromAsync(textChunks(streamed()))).toEqual(["one", "two"]);
  });
});
