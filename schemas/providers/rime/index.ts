import type { Timestamp } from "../../timestamps.ts";

export type TtsInput = string | { readonly command: "clear" } | { readonly command: "flush" };

interface ModernPcm {
  readonly format: "pcm" | "wav";
  /** @integer @exclusiveMinimum 0 @default 24000 */
  readonly sampleRateHz?: number;
  /** @default "signed_integer_16" */
  readonly sampleEncoding?: "signed_integer_16";
  /** Rime uses little-endian PCM even with its audio/L16 MIME type. @default "little_endian" */
  readonly byteOrder?: "little_endian";
}
interface ModernEncoded {
  readonly format: "mp3" | "ogg_opus" | "webm_opus" | "mulaw";
  /** @integer @exclusiveMinimum 0 @default 24000 */
  readonly sampleRateHz?: number;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface LegacyPcm {
  readonly format: "pcm";
  /** Resolved explicitly for both transports. @integer @minimum 4000 @maximum 44100 @default 16000 */
  readonly sampleRateHz?: number;
  /** @default "signed_integer_16" */
  readonly sampleEncoding?: "signed_integer_16";
  /** @default "little_endian" */
  readonly byteOrder?: "little_endian";
}
interface LegacyMp3 {
  readonly format: "mp3";
  /** @integer @minimum 4000 @maximum 44100 @default 22050 */
  readonly sampleRateHz?: number;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface LegacyMuLaw {
  readonly format: "mulaw";
  /** @integer @minimum 4000 @maximum 44100 @default 8000 */
  readonly sampleRateHz?: number;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}

interface Markup {
  /** Interpret native <milliseconds> pause markers. */
  readonly pauses?: boolean;
  /** Interpret native {...} phonetic strings, not IPA or SSML. */
  readonly phonemes?: boolean;
  /** Speaking-speed multipliers for successive [...] spans; positive values, higher is faster. */
  readonly speeds?: readonly number[];
}
interface MarkupWithoutPhonemes {
  readonly pauses?: boolean;
  readonly phonemes?: never;
  readonly speeds?: readonly number[];
}
interface Settings {
  /** Existing catalog speaker or provisioned enterprise-clone UUID. Must match the model and language. @pattern ^[\s\S]+$ */
  readonly voice: string;
  /** Sentence buffering by default; manual waits for flush or input completion. */
  readonly segmentation?: "sentence" | "immediate" | "manual";
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}
interface Modern extends Settings {
  /** Omission selects signed 16-bit little-endian PCM at 24 kHz. */
  readonly output?: ModernPcm | ModernEncoded;
  /** Maps to reciprocal timeScaleFactor. @minimum 0.4 @maximum 2.5 @default 1 */
  readonly speed?: number;
  readonly textNormalization?: never;
}
interface CodaTimed extends Modern {
  readonly model: "coda";
  /** @default "en" */
  readonly language?: "en" | "es";
  readonly timestampGranularity?: "word";
  readonly textMarkup?: never;
}
interface CodaUntimed extends Modern {
  readonly model: "coda";
  readonly language: "fr" | "pt" | "de" | "ja" | "ar" | "hi" | "it";
  readonly timestampGranularity?: never;
  readonly textMarkup?: never;
}
interface Mist3English extends Modern {
  readonly model: "mist-v3";
  /** @default "en" */
  readonly language?: "en";
  readonly timestampGranularity?: "word";
  readonly textMarkup?: Markup;
}
interface Mist3Spanish extends Modern {
  readonly model: "mist-v3";
  readonly language: "es";
  readonly timestampGranularity?: "word";
  readonly textMarkup?: MarkupWithoutPhonemes;
}
interface Mist3Untimed extends Modern {
  readonly model: "mist-v3";
  readonly language: "fr" | "de";
  readonly timestampGranularity?: never;
  readonly textMarkup?: MarkupWithoutPhonemes;
}
interface Mist2 extends Settings {
  readonly model: "mist-v2";
  /** Omission selects signed 16-bit little-endian PCM at 16 kHz. */
  readonly output?: LegacyPcm | LegacyMp3 | LegacyMuLaw;
  /** Maps to reciprocal legacy speedAlpha. @exclusiveMinimum 0 @default 1 */
  readonly speed?: number;
  /** Only Mist v2 exposes the normalization bypass. @default true */
  readonly textNormalization?: boolean;
  readonly textMarkup?: Markup;
}
interface Mist2Timed extends Mist2 {
  /** @default "en" */
  readonly language?: "en" | "es";
  readonly timestampGranularity?: "word";
}
interface Mist2Untimed extends Mist2 {
  readonly language: "fr" | "de";
  readonly timestampGranularity?: never;
}
interface WholeText {
  /** @maxLength 1000 @pattern ^[\s\S]+$ */
  readonly text: string;
}
interface IncrementalText {
  /** Text is sent immediately; each native text frame is limited to 1000 code points. Clear only clears native buffered text, not in-flight generation. */
  readonly text: AsyncIterable<TtsInput>;
}
interface CodaText extends CodaTimed, WholeText {}
interface CodaStream extends CodaTimed, IncrementalText {}
interface CodaOtherText extends CodaUntimed, WholeText {}
interface CodaOtherStream extends CodaUntimed, IncrementalText {}
interface Mist3EnglishText extends Mist3English, WholeText {}
interface Mist3EnglishStream extends Mist3English, IncrementalText {}
interface Mist3SpanishText extends Mist3Spanish, WholeText {}
interface Mist3SpanishStream extends Mist3Spanish, IncrementalText {}
interface Mist3OtherText extends Mist3Untimed, WholeText {}
interface Mist3OtherStream extends Mist3Untimed, IncrementalText {}
interface Mist2Text extends Mist2Timed, WholeText {}
interface Mist2Stream extends Mist2Timed, IncrementalText {}
interface Mist2OtherText extends Mist2Untimed, WholeText {}
interface Mist2OtherStream extends Mist2Untimed, IncrementalText {}

/** Rime's preferred streaming HTTP and JSON WebSocket protocols. Model and language determine capabilities. */
export type TtsRequest = CodaText | CodaStream | CodaOtherText | CodaOtherStream
  | Mist3EnglishText | Mist3EnglishStream | Mist3SpanishText | Mist3SpanishStream | Mist3OtherText | Mist3OtherStream
  | Mist2Text | Mist2Stream | Mist2OtherText | Mist2OtherStream;

/** Audio and timestamps are independent messages, not paired chunks. */
export interface RimeEnvelope {
  readonly correlation: "ordered";
  /** Echoed native context. It is a mutable input label, not a unique synthesis/segment ID. */
  readonly inputGroupId?: string;
  /** Times restart for each native synthesis. Rime does not identify every synthesis boundary; these cannot be placed on a global playback timeline automatically. */
  readonly timestampOrigin: "synthesis";
  readonly audio?: Uint8Array;
  readonly timestamps: readonly Timestamp<"word">[];
}
export interface RimeBatchEvent {
  /** Native done marks a synthesis run, not each flush command and not the end of the connection. */
  readonly event: "batch";
  readonly inputGroupId?: string;
}
