import type { Equal } from "../test-support/types.ts";
import { expect } from "expect";
import { describe, test } from "node:test";
import type { TtsRequest } from "../schemas/base.ts";
import { textChunks } from "./text.ts";

describe("normalized requests", () => {
  test("uses a plain request type", () => {
    true satisfies Equal<TtsRequest, {
      readonly text?: string | AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" } | {
        readonly command: "update";
        readonly replacements: readonly { readonly pattern: string; readonly replacement: string }[];
      }>;
      readonly voice?: string;
      readonly inputType?: "text" | "ssml";
      readonly model?: string;
      readonly language?: string;
      readonly lexicon?: string | readonly string[];
      readonly output?: {
        readonly format: "mp3" | "ogg_vorbis" | "wav" | "pcm" | "ogg_opus" | "alaw" | "mulaw";
        readonly sampleRateHz?: number;
        readonly bitRateBps?: number;
      };
      readonly speed?: number;
      readonly timestampGranularity?: "character";
      readonly textNormalization?: boolean;
      readonly replacements?: readonly {
        readonly pattern: string;
        readonly replacement: string;
      }[];
      readonly latencyOptimization?: "none" | "moderate" | "aggressive";
    }>;
  });

  test("iterates static and streaming input consistently", async () => {
    const streamed = async function* () {
      yield "one";
      yield "two";
    };
    expect(await Array.fromAsync(textChunks("one"))).toStrictEqual(["one"]);
    expect(await Array.fromAsync(textChunks(streamed()))).toStrictEqual(["one", "two"]);
  });
});
