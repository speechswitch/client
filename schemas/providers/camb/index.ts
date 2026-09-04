type StaticOutput =
  | { readonly format: "mp3"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "flac" | "aac"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: number;
      readonly sampleEncoding: "signed_integer_16" | "signed_integer_32" | "float_32";
      readonly byteOrder: "little_endian" | "big_endian";
      readonly bitRateBps?: never;
    };
type LiveOutput =
  | { readonly format: "mp3"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "flac" | "aac"; readonly sampleRateHz?: number; readonly bitRateBps?: never };

interface Common {
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly language: string;
  readonly speed?: number;
  readonly audioEnhancement?: boolean;
  readonly namedEntityPronunciationEnhancement?: boolean;
  readonly referenceAudioEnhancement?: boolean;
  readonly accentPreservation?: boolean;
}
interface Static extends Common {
  /** @minLength 3 @maxLength 3000 */ readonly text: string;
  readonly model: "mars8-flash" | "mars8-instruct" | "mars8-pro";
  readonly output: StaticOutput;
  readonly timestampGranularity?: never;
  readonly streamingBuffer?: never;
  readonly inferenceSteps?: never;
}
interface Live extends Common {
  readonly text: AsyncIterable<string>;
  readonly model: "mars8-flash";
  readonly output: LiveOutput;
  readonly timestampGranularity?: never;
  readonly streamingBuffer?: {
    /** @minimum 0 */ readonly maxDelayMs?: number;
    readonly characterThreshold?: never;
    readonly automatic?: never;
    readonly completionDelayMs?: never;
  };
  readonly inferenceSteps?: number;
}
export type TtsRequest = Static | Live;

export interface TtsRequestWithTimestamps extends Common {
  readonly text: AsyncIterable<string>;
  readonly model: "mars8-flash";
  readonly output: LiveOutput;
  readonly timestampGranularity?: "word";
  readonly streamingBuffer?: {
    /** @minimum 0 */ readonly maxDelayMs?: number;
    readonly characterThreshold?: never;
    readonly automatic?: never;
    readonly completionDelayMs?: never;
  };
  readonly inferenceSteps?: number;
}
