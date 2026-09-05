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
      readonly timestampGranularity?: "character" | "word";
      readonly stability?: number;
      readonly audioEnhancement?: boolean;
      readonly namedEntityPronunciationEnhancement?: boolean;
      readonly referenceAudioEnhancement?: boolean;
      readonly accentPreservation?: boolean;
      readonly textFlushDelayMs?: number;
      readonly inferenceSteps?: number;
      readonly segmentation?: "sentence" | "immediate";
      readonly textNormalization?: boolean;
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
