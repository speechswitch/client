import type { Language } from "../../generated/camb-languages.ts";

type EncodedOutput =
  | { readonly format: "mp3"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "flac" | "aac"; readonly sampleRateHz?: number; readonly bitRateBps?: never };
type PcmOutput = {
  readonly format: "pcm";
  readonly sampleRateHz?: number;
  readonly sampleEncoding: "signed_integer_16" | "signed_integer_32" | "float_32";
  readonly byteOrder: "little_endian" | "big_endian";
  readonly bitRateBps?: never;
};
interface Common {
  /** Existing catalog, shared, or custom voice ID, expressed as a decimal string. */
  readonly voice: string;
  readonly speed?: number;
  readonly audioEnhancement?: boolean;
  readonly namedEntityPronunciationEnhancement?: boolean;
  readonly referenceAudioEnhancement?: boolean;
  readonly accentPreservation?: boolean;
}
interface Static extends Common {
  /** @minLength 3 @maxLength 3000 */
  readonly text: string;
  readonly model: "mars8-flash" | "mars8-instruct" | "mars8-pro" | "mars8.1-flash-beta" | "mars8.1-pro-beta";
  readonly language: Language;
  readonly output: EncodedOutput | PcmOutput;
  readonly timestampGranularity?: never;
  readonly textFlushDelayMs?: never;
  readonly inferenceSteps?: never;
}
interface LiveOptions extends Common {
  /** Live TTS is fixed to this model; the protocol has no model selector. */
  readonly model: "mars8.1-flash-beta";
  readonly language: Language;
  readonly output: EncodedOutput;
  /** @minimum 0 */
  readonly textFlushDelayMs?: number;
  readonly inferenceSteps?: number;
}
interface Live extends LiveOptions {
  readonly text: AsyncIterable<string>;
  readonly timestampGranularity?: "word";
}
interface TimedStatic extends LiveOptions {
  readonly text: string;
  readonly timestampGranularity: "word";
}

export type TtsRequest = Static | Live | TimedStatic;
