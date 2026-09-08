interface PcmOutput {
  readonly format: "pcm";
  /** @default 24000 */
  readonly sampleRateHz?: 24000;
  /** @default "signed_integer_16" */
  readonly sampleEncoding?: "signed_integer_16";
  /** @default "little_endian" */
  readonly byteOrder?: "little_endian";
  /** @default 1 */
  readonly channelCount?: 1;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
}
interface EncodedOutput {
  /** Native Opus framing is not specified as Ogg or raw packets. */
  readonly format: "mp3" | "opus" | "aac" | "flac" | "wav";
  readonly sampleRateHz?: never;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  readonly channelCount?: never;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
}
interface LegacyRequest {
  /** @default "tts-1" */
  readonly model?: "tts-1" | "tts-1-hd";
  /** @maxLength 4096 */
  readonly text: string;
  readonly voice: "alloy" | "ash" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer";
  readonly voiceSource?: "catalog";
  /** @minimum 0.25 @maximum 4 @default 1 */
  readonly speed?: number;
  /** Omission selects byte-native PCM. */
  readonly output?: PcmOutput | EncodedOutput;
  readonly instructions?: never;
  readonly includeUsage?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly language?: never;
  readonly timestampGranularity?: never;
  readonly timestampDelivery?: never;
  readonly inputType?: never;
}
interface MiniCatalogRequest {
  readonly model: "gpt-4o-mini-tts" | "gpt-4o-mini-tts-2025-03-20" | "gpt-4o-mini-tts-2025-12-15";
  /** The model also has a server-enforced token limit; characters are not tokens. @maxLength 4096 */
  readonly text: string;
  readonly voice: "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer" | "verse" | "marin" | "cedar";
  readonly voiceSource?: "catalog";
  /** @maxLength 4096 */
  readonly instructions?: string;
  /** @minimum 0.25 @maximum 4 @default 1 */
  readonly speed?: number;
  readonly output?: PcmOutput | EncodedOutput;
  /** SSE includes native usage, whereas binary audio avoids base64 overhead. @default false */
  readonly includeUsage?: boolean;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly language?: never;
  readonly timestampGranularity?: never;
  readonly timestampDelivery?: never;
  readonly inputType?: never;
}
interface MiniCustomRequest {
  readonly model: "gpt-4o-mini-tts" | "gpt-4o-mini-tts-2025-03-20" | "gpt-4o-mini-tts-2025-12-15";
  /** @maxLength 4096 */
  readonly text: string;
  /** Existing custom voice ID; it is not inferred from a prefix. */
  readonly voice: string;
  readonly voiceSource: "custom";
  /** @maxLength 4096 */
  readonly instructions?: string;
  /** @minimum 0.25 @maximum 4 @default 1 */
  readonly speed?: number;
  readonly output?: PcmOutput | EncodedOutput;
  /** @default false */
  readonly includeUsage?: boolean;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly language?: never;
  readonly timestampGranularity?: never;
  readonly timestampDelivery?: never;
  readonly inputType?: never;
}
/** Whole-text speech generation; Realtime conversation generation is a different API. */
export type TtsRequest = LegacyRequest | MiniCatalogRequest | MiniCustomRequest;

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}
export interface DoneEvent {
  readonly event: "done";
  readonly requestId?: string;
  readonly usage?: Usage;
}
export type SynthesisItem = Uint8Array | DoneEvent;
