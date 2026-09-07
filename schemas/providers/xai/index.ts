import type { ClearEvent, DoneEvent } from "../../stream.ts";
export type { ClearEvent, DoneEvent } from "../../stream.ts";

type Language =
  | "auto" | "en" | "ar-EG" | "ar-SA" | "ar-AE" | "bn" | "zh" | "fr" | "de"
  | "hi" | "id" | "it" | "ja" | "ko" | "pt-BR" | "pt-PT" | "ru" | "es-MX"
  | "es-ES" | "tr" | "vi";

type Output =
  | {
      readonly format: "mp3";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      readonly bitRateBps?: 32000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "wav" | "pcm" | "alaw" | "mulaw";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      readonly bitRateBps?: never;
    };

interface Replacement {
  /** @maxLength 100 */
  readonly pattern: string;
  /** @maxLength 128 */
  readonly replacement: string;
}

interface Common {
  readonly voice?: string;
  readonly model?: "grok-tts";
  /** @default "auto" */
  readonly language?: Language;
  readonly output?: Output;
  /** @minimum 0.7 @maximum 1.5 */
  readonly speed?: number;
  readonly textNormalization?: boolean;
  /** @maxItems 200 */
  readonly replacements?: readonly Replacement[];
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
  readonly timestampGranularity?: "character";
}

export type TtsInput =
  | string
  | { readonly command: "clear" }
  | { readonly command: "flush" }
  | {
      readonly command: "update";
      /** Replaces the session map for utterances starting after this update; [] removes it. @maxItems 200 */
      readonly replacements: readonly Replacement[];
    };

interface SingleInput extends Common {
  /** @maxLength 15000 */
  readonly text: string;
}
interface StreamingInput extends Common {
  readonly text: AsyncIterable<TtsInput>;
}

export type TtsRequest = SingleInput | StreamingInput;

export interface CharacterTimestamp {
  readonly kind: "character";
  readonly value: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
}
export interface TimestampedAudio {
  /** Native character intervals belong to this audio chunk, not an inferred timeline. */
  readonly correlation: "chunk";
  readonly audio: Uint8Array;
  readonly timestamps: readonly CharacterTimestamp[];
  readonly durationMs?: number;
}
export interface UpdatedEvent {
  readonly event: "updated";
  /** The map echoed by the server, not locally assumed state. */
  readonly replacements: readonly { readonly pattern: string; readonly replacement: string }[];
}
export type StreamEvent = ClearEvent | UpdatedEvent | DoneEvent;
export type SynthesisItem = Uint8Array | TimestampedAudio | StreamEvent;
/** Native built-in voice discovery result; synthesis also accepts existing custom IDs. */
export interface Voice {
  readonly voice_id: string;
  readonly name: string;
  readonly language?: string | null;
}
