type Output =
  | { readonly format: "mp3"; readonly sampleRateHz: number; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz: number; readonly bitRateBps?: never }
  | { readonly format: "ogg_opus"; readonly sampleRateHz: number; readonly bitRateBps?: never }
  | { readonly format: "webm_opus"; readonly sampleRateHz: number; readonly bitRateBps?: never }
  | { readonly format: "pcm"; readonly sampleRateHz: number; readonly sampleEncoding?: "signed_integer_16"; readonly bitRateBps?: never }
  | { readonly format: "mulaw"; readonly sampleRateHz: number; readonly bitRateBps?: never };

interface Common {
  readonly voice: string;
  readonly language?: "en" | "es" | "fr" | "pt" | "de" | "ja" | "ar" | "hi" | "it";
  readonly output: Output;
  readonly speed?: number;
}

interface Coda extends Common {
  readonly model: "coda";
  readonly inlinePauses?: never;
  readonly inlinePhonemes?: never;
  readonly inlineSpeedFactors?: never;
  readonly textNormalization?: never;
}
interface MistV3 extends Common {
  readonly model: "mist-v3";
  readonly inlinePauses?: boolean;
  readonly inlinePhonemes?: never;
  readonly inlineSpeedFactors?: readonly number[];
  readonly textNormalization?: never;
}
interface MistV2 extends Common {
  readonly model: "mist-v2";
  readonly inlinePauses?: boolean;
  readonly inlinePhonemes?: boolean;
  readonly inlineSpeedFactors?: readonly number[];
  readonly textNormalization?: boolean;
}

interface StaticCoda extends Coda { /** @maxLength 1000 */ readonly text: string; readonly segmentation?: never }
interface StaticMistV3 extends MistV3 { /** @maxLength 1000 */ readonly text: string; readonly segmentation?: never }
interface StaticMistV2 extends MistV2 { /** @maxLength 1000 */ readonly text: string; readonly segmentation?: never }
interface StreamingCoda extends Coda { readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>; readonly segmentation?: "immediate" | "sentence" | "explicit" }
interface StreamingMistV3 extends MistV3 { readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>; readonly segmentation?: "immediate" | "sentence" | "explicit" }
interface StreamingMistV2 extends MistV2 { readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>; readonly segmentation?: "immediate" | "sentence" | "explicit" }

export type TtsRequest = StaticCoda | StaticMistV3 | StaticMistV2 | StreamingCoda | StreamingMistV3 | StreamingMistV2;
interface TimestampCommon {
  readonly voice: string;
  readonly language?: "en" | "es";
  readonly output: Output;
  readonly speed?: number;
  readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>;
  readonly segmentation?: "immediate" | "sentence" | "explicit";
  readonly timestampGranularity?: "word";
}
interface TimestampCoda extends TimestampCommon { readonly model: "coda"; readonly inlinePauses?: never; readonly inlinePhonemes?: never; readonly inlineSpeedFactors?: never; readonly textNormalization?: never }
interface TimestampMistV3 extends TimestampCommon { readonly model: "mist-v3"; readonly inlinePauses?: boolean; readonly inlinePhonemes?: never; readonly inlineSpeedFactors?: readonly number[]; readonly textNormalization?: never }
interface TimestampMistV2 extends TimestampCommon { readonly model: "mist-v2"; readonly inlinePauses?: boolean; readonly inlinePhonemes?: boolean; readonly inlineSpeedFactors?: readonly number[]; readonly textNormalization?: boolean }
export type TtsRequestWithTimestamps = TimestampCoda | TimestampMistV3 | TimestampMistV2;
