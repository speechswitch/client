import { describe, expect, expectTypeOf, test } from "bun:test";
import type { TtsOutput, TtsRequest } from "../schemas/base.ts";
import { textChunks } from "./text.ts";

describe("normalized requests", () => {
  test("uses a plain request type", () => {
    expectTypeOf<TtsRequest>().toEqualTypeOf<{
      readonly text?: string | AsyncIterable<
        string | { readonly command: "clear" } | { readonly command: "flush" }
      >;
      readonly voice?: string;
      readonly referenceAudio?: Uint8Array;
      readonly voiceVariant?: string;
      readonly voiceSource?: "catalog" | "custom";
      readonly inputType?: "text" | "ssml";
      readonly model?: string;
      readonly language?: string;
      readonly numberReadingLanguage?: string;
      readonly interpretMath?: boolean;
      readonly lexicon?: string | readonly string[];
      readonly output?:
        | {
            readonly format: "mp3" | "ogg_vorbis";
            readonly sampleRateHz?: number;
            readonly bitRateBps?: 32000 | 48000 | 64000 | 96000 | 128000 | 160000 | 192000 | 256000 | 320000;
          }
        | {
            readonly format: "wav";
            readonly sampleRateHz?: number;
            readonly bitRateBps?: never;
          }
        | {
            readonly format: "pcm";
            readonly sampleRateHz?: number;
            readonly sampleEncoding?: "signed_integer_16" | "float_32";
            readonly bitRateBps?: never;
          }
        | {
            readonly format: "ogg_opus" | "webm_opus";
            readonly sampleRateHz?: number;
            readonly bitRateBps?: 24000 | 32000 | 48000 | 64000 | 96000 | 128000 | 192000;
          }
        | { readonly format: "alaw" | "mulaw"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
        | {
            readonly format: "flac" | "aac";
            readonly sampleRateHz?: number;
            readonly bitRateBps?: number;
          };
      readonly speed?: number;
      readonly deliveryInstructions?: string;
      readonly deliveryVariation?: "stable" | "balanced" | "creative";
      readonly trailingSilenceSeconds?: number;
      readonly temperature?: number;
      readonly randomSeed?: number;
      readonly minimumTokenProbability?: number;
      readonly topProbabilityMass?: number;
      readonly topTokenCount?: number;
      readonly repetitionPenalty?: number;
      readonly presencePenalty?: number;
      readonly frequencyPenalty?: number;
      readonly guidanceScale?: number;
      readonly maxOutputTokens?: number;
      readonly continuityId?: string;
      readonly volumeDb?: number;
      readonly volumeScale?: number;
      readonly pitchSemitones?: number;
      readonly emotion?: string;
      readonly emotionIntensity?: number;
      readonly surroundingContext?: { readonly previous?: string; readonly next?: string };
      readonly targetLoudnessLufs?: number;
      readonly loudnessNormalization?: boolean;
      readonly audioEnhancement?: boolean;
      readonly referenceAudioTrimming?: boolean;
      readonly voiceTuning?: {
        readonly stability?: number;
        readonly similarity?: number;
        readonly style?: number;
        readonly speakerBoost?: boolean;
      };
      readonly textNormalization?: boolean;
      readonly contextTexts?: readonly string[];
      readonly dictionarySelection?: {
        readonly projectId?: string | number;
        readonly dictionaryIds?: readonly (string | number)[];
      };
      readonly timestampGranularity?: "character" | "word" | "sentence" | "phoneme" | "viseme";
      readonly replacements?: readonly {
        readonly pattern: string;
        readonly replacement: string;
      }[];
      readonly latencyOptimization?: "none" | "moderate" | "aggressive";
      readonly streamingBuffer?: {
        readonly maxDelayMs?: number;
        readonly characterThreshold?: number;
        readonly automatic?: boolean;
        readonly completionDelayMs?: number;
      };
      readonly segmentation?: "immediate" | "sentence" | "explicit";
      readonly inlinePauses?: boolean;
      readonly inlinePhonemes?: boolean;
      readonly inlineSpeedFactors?: readonly number[];
      readonly segments?: readonly (
        | {
            readonly text: string;
            readonly voice: string;
            readonly model: string;
            readonly language?: string;
            readonly output: TtsOutput;
            readonly speed?: number;
            readonly volumeScale?: number;
            readonly pitchSemitones?: number;
            readonly targetLoudnessLufs?: number;
            readonly emotion?: string;
            readonly emotionIntensity?: number;
            readonly surroundingContext?: { readonly previous?: string; readonly next?: string };
            readonly randomSeed?: number;
          }
        | { readonly pauseSeconds: number }
      )[];
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
