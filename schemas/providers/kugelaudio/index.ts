import type { ClearEvent, UpdatedEvent } from "../../stream.ts";

type Language = "de" | "en" | "fr" | "es" | "it" | "pt" | "nl" | "pl" | "sv" | "da" | "no" | "fi" | "cs" | "hu" | "ro" | "el" | "uk" | "bg" | "tr" | "vi" | "ar" | "hi" | "zh" | "ja" | "ko" | "sk" | "sl" | "hr" | "sr" | "ru" | "he" | "fa" | "ur" | "bn" | "ta" | "yue" | "th" | "id" | "ms";

interface Pcm {
  readonly format: "pcm";
  /** Native generation is 24 kHz; other rates are resampled. @default 24000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100;
  readonly sampleEncoding?: "signed_integer_16";
  readonly byteOrder?: "little_endian";
  readonly bitRateBps?: never;
}
interface Telephony {
  readonly format: "mulaw" | "alaw";
  /** @default 8000 */
  readonly sampleRateHz?: 8000;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  readonly bitRateBps?: never;
}

export interface UpdateCommand {
  readonly command: "update";
  /** Takes effect on the next turn, not generation already in flight. @minimum 1.2 @maximum 2.5 */
  readonly voiceGuidance?: number;
  /** @minimum 0 @maximum 1 */
  readonly temperature?: number;
  /** @minimum 1 @maximum 2048 @integer */
  readonly maxAudioTokens?: number;
  readonly language?: Language;
  readonly textNormalization?: boolean;
  /** @minimum 0.8 @maximum 1.2 */
  readonly speed?: number;
  readonly replacements?: never;
  /** Voice, model, format and dictionary identity cannot change through update_settings. */
  readonly voice?: never;
  readonly model?: never;
  readonly output?: never;
  readonly pronunciationDictionarySelection?: never;
}

interface Settings {
  /** Existing catalog or custom voice handle, or legacy numeric ID. There is no default voice. */
  readonly voice: string | number;
  /** Legacy IDs remain accepted but may route to the current production model. @default "kugel-3" */
  readonly model?: "kugel-3" | "kugel-2.5" | "kugel-2-turbo" | "kugel-2" | "kugel-1" | "kugel-1-turbo";
  readonly output: Pcm | Telephony;
  /** Omission preserves automatic language detection during normalization. */
  readonly language?: Language;
  /** @minimum 1.2 @maximum 2.5 @default 2 */
  readonly voiceGuidance?: number;
  /** @minimum 1 @maximum 2048 @default 2048 @integer */
  readonly maxAudioTokens?: number;
  /** @minimum 0.8 @maximum 1.2 @default 1 */
  readonly speed?: number;
  /** @default true */
  readonly textNormalization?: boolean;
  /** Project-scoped dictionaries. Omitted selection loads none. Explicit IDs include inactive dictionaries and bypass language filtering. */
  readonly pronunciationDictionarySelection?: {
    /** @integer */
    readonly scope: number;
    /** @maxItems 50 @itemInteger */
    readonly ids?: readonly number[];
  };
  /** Forced alignment arrives after audio, relative to the native text chunk. */
  readonly timestampGranularity?: "word";
  readonly timestampText?: "normalized";
  readonly timestampDelivery?: "trailing";
  /** Inject the native speaker prefix to strengthen voice consistency (native default true); selects WebSocket even for whole text. */
  readonly voiceBoost?: boolean;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}

export interface StaticRequest extends Settings {
  /** Inline break, spell, and prosody rate tags pass through unchanged; this is not a general SSML endpoint. @pattern ^(?=[\s\S]*\S)[\s\S]{1,10000}$ */
  readonly text: string;
  /** @minimum 0 @maximum 1 @default 0.4 */
  readonly temperature?: number;
  readonly textFlushDelayMs?: never;
  readonly textBufferThreshold?: never;
}
export interface StreamingRequest extends Settings {
  readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" } | UpdateCommand>;
  /** Omission leaves the live engine setting unset, unlike the static endpoint's 0.4 default. @minimum 0 @maximum 1 */
  readonly temperature?: number;
  /** @default 500 @integer */
  readonly textFlushDelayMs?: number;
  /** Maximum buffered characters before a forced flush. @default 10000 @integer */
  readonly textBufferThreshold?: number;
}

/** Native KugelAudio synthesis; model aliases share capabilities, while input mode determines defaults and buffering controls. */
export type TtsRequest = StaticRequest | StreamingRequest;

export interface KugelAudioTimestamp {
  readonly kind: "word";
  readonly value: string;
  readonly startTimeMs: number;
  readonly endTimeMs?: number;
  readonly source?: { readonly start: number; readonly end: number };
  /** Native alignment confidence; currently a compatibility value. */
  readonly confidence?: number;
}
export interface KugelAudioEnvelope {
  readonly correlation: "ordered";
  /** Turn ordinal plus native chunk_id; time and character offsets restart in this group. */
  readonly correlationId: string;
  readonly inputGroupId: string;
  readonly chunkId: number;
  readonly audio?: Uint8Array;
  readonly audioTiming?: { readonly startTimeMs: number; readonly endTimeMs: number };
  readonly timestamps: readonly KugelAudioTimestamp[];
}
export interface KugelAudioUsage {
  readonly audioSeconds: number;
  readonly characters: number;
  /** Null means unavailable, not free. */
  readonly costCents: number | null;
  readonly currency?: "eur";
  readonly model?: string;
}
export interface KugelAudioTurnEvent {
  readonly event: "flush";
  readonly correlationId: string;
  readonly inputGroupId: string;
  readonly usage?: KugelAudioUsage;
}
export interface KugelAudioDoneEvent { readonly event: "done"; readonly usage?: KugelAudioUsage }
export type SynthesisItem = Uint8Array | KugelAudioEnvelope | ClearEvent | UpdatedEvent | KugelAudioTurnEvent | KugelAudioDoneEvent;
