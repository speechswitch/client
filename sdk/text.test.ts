import { describe, expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest } from "../schemas/base.ts";
import { textChunks } from "./text.ts";

describe("normalized requests", () => {
  test("uses a plain request type", () => {
    expectTypeOf<TtsRequest>().toEqualTypeOf<{
      readonly text?: string | AsyncIterable<string>;
      readonly voice?: string;
      readonly inputType?: "text" | "ssml";
      readonly model?: string;
      readonly language?: string;
      readonly lexicon?: string | readonly string[];
      readonly output?:
        | {
            readonly format: "mp3" | "ogg_vorbis";
            readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
            readonly bitRateBps?: 32000 | 64000 | 96000 | 128000 | 192000;
          }
        | {
            readonly format: "wav";
            readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
            readonly bitRateBps?: never;
          }
        | { readonly format: "pcm"; readonly sampleRateHz?: 8000 | 16000; readonly bitRateBps?: never }
        | { readonly format: "ogg_opus"; readonly sampleRateHz?: 48000; readonly bitRateBps?: never }
        | { readonly format: "alaw" | "mulaw"; readonly sampleRateHz?: 8000; readonly bitRateBps?: never };
      readonly speed?: number;
      readonly textNormalization?: boolean;
      readonly replacements?: readonly {
        readonly pattern: string;
        readonly replacement: string;
      }[];
      readonly optimizeStreamingLatency?: boolean;
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
