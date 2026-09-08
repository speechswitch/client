import type { Timestamp as GenericTimestamp, SynthesisEnvelope as GenericEnvelope } from "./timestamps.ts";

// Concrete roots for foreign languages; the generic TypeScript API remains in timestamps.ts.
export type Timestamp = GenericTimestamp;
export type SynthesisEnvelope = GenericEnvelope;

export interface ClearEvent { readonly event: "clear" }
export interface FlushEvent {
  readonly event: "flush";
  readonly correlationId: string;
  readonly inputGroupId: string;
}
export interface UpdatedEvent {
  readonly event: "updated";
  readonly replacements?: readonly { readonly pattern: string; readonly replacement: string }[];
  readonly voiceGuidance?: number;
  readonly temperature?: number;
  readonly maxAudioTokens?: number;
  readonly language?: string;
  readonly textNormalization?: boolean;
  readonly speed?: number;
}
export interface DoneEvent { readonly event: "done"; readonly traceId?: string }

/** Transport messages, not a union of provider/model capability combinations. */
export type AudioStreamItem = Uint8Array | SynthesisEnvelope | ClearEvent | UpdatedEvent | DoneEvent | FlushEvent;
export type TimestampStreamItem = SynthesisEnvelope | ClearEvent | UpdatedEvent | DoneEvent | FlushEvent;
export type AudioStream = AsyncIterable<AudioStreamItem>;
export type TimestampStream = AsyncIterable<TimestampStreamItem>;
