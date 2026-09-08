import type { Timestamp } from "../../timestamps.ts";

type StandardLanguage = "auto" | "en" | "hi" | "mr" | "kn" | "ta" | "bn" | "gu" | "te" | "ml" | "pa" | "or" | "es" | "de" | "fr" | "it" | "nl" | "sv" | "pt" | "pl" | "ru";
type ProLanguage = StandardLanguage | "el" | "fi" | "no" | "ar" | "zh" | "id" | "ja" | "ko" | "ms" | "tr" | "vi";
export type TtsInput = string | { readonly command: "clear" };
interface PcmOutput {
  readonly format: "pcm" | "wav";
  /** @default 44100 */
  readonly sampleRateHz?: 8000 | 16000 | 24000 | 44100;
  /** @default "signed_integer_16" */
  readonly sampleEncoding?: "signed_integer_16";
  /** @default "little_endian" */
  readonly byteOrder?: "little_endian";
  /** @default 1 */
  readonly channelCount?: 1;
}
interface EncodedOutput {
  readonly format: "mp3" | "mulaw" | "alaw";
  /** @default 44100 */
  readonly sampleRateHz?: 8000 | 16000 | 24000 | 44100;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  /** @default 1 */
  readonly channelCount?: 1;
}
interface Settings {
  /** Catalog or existing cloned voice ID; match the model pool used to create the voice. @pattern ^\S+$ */
  readonly voice: string;
  /** Omission selects mono signed 16-bit little-endian PCM at 44.1 kHz. */
  readonly output?: PcmOutput | EncodedOutput;
  /** @minimum 0.5 @maximum 2 @default 1 */
  readonly speed?: number;
  /** Read digit-flanked math operators; false preserves ordinary number reading. @default false */
  readonly formulaReading?: "plain_text" | false;
  /** Enterprise opt-in to deletion after seven days. Omission retains content; this is not zero-retention. */
  readonly contentRetentionDays?: 7;
  /** @maxLength 128 @pattern ^[a-zA-Z0-9_.-]+$ */
  readonly sessionId?: string;
  /** @maxLength 128 @pattern ^[a-zA-Z0-9_.-]+$ */
  readonly requestId?: string;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}
interface Standard extends Settings {
  readonly model: "lightning-v3.1";
  /** Explicit auto routing avoids coupling number pronunciation to voice selection. @default "auto" */
  readonly language?: StandardLanguage;
  readonly numberPronunciationLanguage?: StandardLanguage;
}
interface Pro extends Settings {
  readonly model: "lightning-v3.1-pro";
  /** The SDK selects auto explicitly; native omission would select mixed en+hi. @default "auto" */
  readonly language?: ProLanguage;
  readonly numberPronunciationLanguage?: ProLanguage;
}
interface WholeText {
  /** Trimmed at the public boundary before generated validation. @maxLength 8000 @pattern \S */
  readonly text: string;
  readonly pronunciationDictionaries?: readonly { readonly id: string; readonly versionId?: never }[];
  readonly timestampGranularity?: never;
  readonly continuation?: never;
  readonly maxBufferDelayMs?: never;
  readonly completionDelayMs?: never;
}
interface Incremental {
  readonly text: AsyncIterable<string>;
  readonly pronunciationDictionaries?: never;
  readonly timestampGranularity?: never;
  readonly continuation?: never;
  /** Legacy timer-based buffering. @integer @minimum 0 @maximum 1000 @default 0 */
  readonly maxBufferDelayMs?: number;
  /** The server may complete early if an input producer pauses longer than this grace period. @minimum 0 @maximum 10000 @default 4000 */
  readonly completionDelayMs?: number;
}
interface Continued {
  /** Clear discards buffered text, not acknowledged in-flight cancellation. */
  readonly text: AsyncIterable<TtsInput>;
  readonly pronunciationDictionaries?: never;
  readonly timestampGranularity?: never;
  /** No native context-complete marker: this mode drains until caller cancellation, never an idle-success heuristic. */
  readonly continuation: {
    /** @maxLength 128 @pattern ^[a-zA-Z0-9_.-]+$ */
    readonly id: string;
    /** @integer @minimum 0 @maximum 5000 @default 3000 */
    readonly maxBufferDelayMs?: number;
  };
  readonly maxBufferDelayMs?: never;
  readonly completionDelayMs?: never;
}
interface Timed extends Settings {
  /** Only documented English/Hindi aligner-equipped voice families. Custom voices remain available in untimed variants. */
  readonly voice: "meher" | "devansh" | "kartik" | "maithili" | "liam" | "avery";
  /** Alignment is documented only for English and Hindi. @default "en" */
  readonly language?: "en" | "hi";
  readonly timestampGranularity: "word";
  readonly pronunciationDictionaries?: never;
}
interface TimedText extends Timed {
  /** @maxLength 8000 @pattern \S */
  readonly text: string;
  readonly continuation?: never;
  readonly maxBufferDelayMs?: never;
  readonly completionDelayMs?: never;
}
interface TimedIncremental extends Timed {
  readonly text: AsyncIterable<string>;
  readonly continuation?: never;
  /** @integer @minimum 0 @maximum 1000 @default 0 */
  readonly maxBufferDelayMs?: number;
  /** @minimum 0 @maximum 10000 @default 4000 */
  readonly completionDelayMs?: number;
}
interface TimedContinued extends Timed {
  readonly text: AsyncIterable<TtsInput>;
  readonly continuation: {
    /** @maxLength 128 @pattern ^[a-zA-Z0-9_.-]+$ */
    readonly id: string;
    /** @integer @minimum 0 @maximum 5000 @default 3000 */
    readonly maxBufferDelayMs?: number;
  };
  readonly maxBufferDelayMs?: never;
  readonly completionDelayMs?: never;
}
interface StandardText extends Standard, WholeText {}
interface ProText extends Pro, WholeText {}
interface StandardStream extends Standard, Incremental {}
interface ProStream extends Pro, Incremental {}
interface StandardContinuation extends Standard, Continued {}
interface ProContinuation extends Pro, Continued {}
interface StandardTimedText extends TimedText { readonly model: "lightning-v3.1"; readonly numberPronunciationLanguage?: StandardLanguage; }
interface ProTimedText extends TimedText { readonly model: "lightning-v3.1-pro"; readonly numberPronunciationLanguage?: ProLanguage; }
interface StandardTimedStream extends TimedIncremental { readonly model: "lightning-v3.1"; readonly numberPronunciationLanguage?: StandardLanguage; }
interface ProTimedStream extends TimedIncremental { readonly model: "lightning-v3.1-pro"; readonly numberPronunciationLanguage?: ProLanguage; }
interface StandardTimedContinuation extends TimedContinued { readonly model: "lightning-v3.1"; readonly numberPronunciationLanguage?: StandardLanguage; }
interface ProTimedContinuation extends TimedContinued { readonly model: "lightning-v3.1-pro"; readonly numberPronunciationLanguage?: ProLanguage; }

/** Current Smallest.ai models. Lightning v2 is retired (410), not a supported variant. */
export type TtsRequest = StandardText | ProText | StandardStream | ProStream | StandardContinuation | ProContinuation
  | StandardTimedText | ProTimedText | StandardTimedStream | ProTimedStream | StandardTimedContinuation | ProTimedContinuation;

export interface SmallestEnvelope {
  readonly correlation: "ordered";
  /** Native synthesis request_id, not inferred from audio/timestamp arrival order. */
  readonly correlationId: string;
  readonly audio?: Uint8Array;
  readonly timestamps: readonly Timestamp<"word">[];
  /** Native position within the input, not a fabricated character range. */
  readonly wordIndex?: number;
}
export interface SmallestBatchEvent {
  readonly event: "batch";
  readonly requestId: string;
}
