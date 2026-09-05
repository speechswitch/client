import { describe, expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest } from "../schemas/base.ts";
import { textChunks } from "./text.ts";

describe("normalized requests", () => {
  test("uses a plain request type", () => {
    expectTypeOf<TtsRequest>().toEqualTypeOf<{
      readonly text?: string | AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>;
      readonly voice?: string;
      readonly inputType?: "text" | "ssml";
      readonly model?: string;
      readonly language?: string;
      readonly lexicon?: string | readonly string[];
      readonly output?:
        | {
            readonly format: "mp3" | "ogg_vorbis";
            readonly sampleRateHz?: number;
            readonly bitRateBps?: number;
          }
        | {
            readonly format: "wav";
            readonly sampleRateHz?: number;
            readonly sampleEncoding?: "signed_integer_16" | "float_32" | "mulaw" | "alaw";
            readonly byteOrder?: "little_endian";
            readonly bitRateBps?: never;
          }
        | { readonly format: "pcm"; readonly sampleRateHz?: number; readonly sampleEncoding?: "signed_integer_16" | "signed_integer_32" | "float_32"; readonly byteOrder?: "little_endian" | "big_endian"; readonly bitRateBps?: never }
        | { readonly format: "ogg_opus"; readonly sampleRateHz?: 48000; readonly bitRateBps?: never }
        | { readonly format: "alaw" | "mulaw"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
        | {
            readonly format: "flac" | "aac";
            readonly sampleRateHz?: number;
            readonly bitRateBps?: number;
          };
      readonly speed?: number;
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
      readonly timestampGranularity?: "word" | "phoneme" | readonly ("word" | "phoneme")[];
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
