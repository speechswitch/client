interface FalconOutput {
  /** OGG's codec is unspecified in the current contract. */
  readonly format: "pcm" | "wav" | "mp3" | "flac" | "alaw" | "mulaw" | "ogg";
  /** @default 24000 */
  readonly sampleRateHz?: 8000 | 16000 | 24000 | 44100 | 48000;
  /** @default 1 */
  readonly channelCount?: 1 | 2;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
}
interface Gen2Output {
  readonly format: "pcm" | "wav" | "mp3" | "flac" | "alaw" | "mulaw" | "ogg";
  /** @default 44100 */
  readonly sampleRateHz?: 8000 | 24000 | 44100 | 48000;
  /** @default 1 */
  readonly channelCount?: 1 | 2;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
}
export interface UpdateCommand {
  readonly command: "update";
  readonly voice?: string;
  readonly voiceStyle?: string;
  readonly language?: string;
  /** Native integer scale; zero is neutral, positive is faster. @integer @minimum -50 @maximum 50 */
  readonly speedBias?: number;
  /** Native integer scale, not semitones. @integer @minimum -50 @maximum 50 */
  readonly pitchBias?: number;
  /** Integer character threshold. @integer @minimum 40 @maximum 160 */
  readonly textBufferThreshold?: number;
  /** Integer delay in milliseconds. @integer @minimum 0 @maximum 1000 */
  readonly maxBufferDelayMs?: number;
  readonly replacements?: never;
  readonly speed?: never;
}
export type TtsInput = string | { readonly command: "clear" } | { readonly command: "flush" } | UpdateCommand;

interface FalconText {
  /** @default "falcon-2" */
  readonly model?: "falcon-2";
  /** @pattern ^[\s\S]{0,3000}$ */
  readonly text: string;
  readonly voice: string;
  readonly voiceStyle?: string;
  readonly language?: string;
  /** @integer @minimum -50 @maximum 50 @default 0 */
  readonly speedBias?: number;
  /** @integer @minimum -50 @maximum 50 @default 0 */
  readonly pitchBias?: number;
  /** Omission requests PCM. */
  readonly output?: FalconOutput;
  readonly deliveryVariance?: never;
  readonly targetDurationMs?: never;
  readonly timestampGranularity?: never;
  readonly timestampText?: never;
  readonly textBufferThreshold?: never;
  readonly maxBufferDelayMs?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly replacements?: never;
  readonly speed?: never;
  readonly inputType?: never;
  readonly audioRetention?: never;
}
interface FalconStreaming {
  /** @default "falcon-2" */
  readonly model?: "falcon-2";
  readonly text: AsyncIterable<TtsInput>;
  readonly voice: string;
  readonly voiceStyle?: string;
  readonly language?: string;
  /** @integer @minimum -50 @maximum 50 @default 0 */
  readonly speedBias?: number;
  /** @integer @minimum -50 @maximum 50 @default 0 */
  readonly pitchBias?: number;
  readonly output?: FalconOutput;
  /** Integer character threshold. @integer @minimum 40 @maximum 160 @default 40 */
  readonly textBufferThreshold?: number;
  /** Integer delay in milliseconds. @integer @minimum 0 @maximum 1000 @default 300 */
  readonly maxBufferDelayMs?: number;
  readonly deliveryVariance?: never;
  readonly targetDurationMs?: never;
  readonly timestampGranularity?: never;
  readonly timestampText?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly replacements?: never;
  readonly speed?: never;
  readonly inputType?: never;
  readonly audioRetention?: never;
}
interface Gen2Normalized {
  readonly model: "gen2";
  /** @pattern ^[\s\S]{0,3000}$ */
  readonly text: string;
  readonly voice: string;
  readonly voiceStyle?: string;
  readonly language?: string;
  /** @integer @minimum -50 @maximum 50 @default 0 */
  readonly speedBias?: number;
  /** @integer @minimum -50 @maximum 50 @default 0 */
  readonly pitchBias?: number;
  /** Native variation 0–5 normalized to 0–1. @default 0.2 */
  readonly deliveryVariance?: 0 | 0.2 | 0.4 | 0.6 | 0.8 | 1;
  /** Zero leaves duration unconstrained. @minimum 0 */
  readonly targetDurationMs?: number;
  readonly output?: Gen2Output;
  readonly timestampGranularity?: "word";
  /** @default "normalized" */
  readonly timestampText?: "normalized";
  /** False requests inline base64 audio with zero audio-file retention. @default true */
  readonly audioRetention?: boolean;
  readonly textBufferThreshold?: never;
  readonly maxBufferDelayMs?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly replacements?: never;
  readonly speed?: never;
  readonly inputType?: "text" | "markup";
}
interface Gen2Original {
  readonly model: "gen2";
  /** @pattern ^[\s\S]{0,3000}$ */
  readonly text: string;
  readonly voice: string;
  readonly voiceStyle?: string;
  /** Original-text word alignment is English-only; select the locale explicitly. @pattern ^en(?:-|$) */
  readonly language: string;
  /** @integer @minimum -50 @maximum 50 @default 0 */
  readonly speedBias?: number;
  /** @integer @minimum -50 @maximum 50 @default 0 */
  readonly pitchBias?: number;
  /** @default 0.2 */
  readonly deliveryVariance?: 0 | 0.2 | 0.4 | 0.6 | 0.8 | 1;
  /** @minimum 0 */
  readonly targetDurationMs?: number;
  readonly output?: Gen2Output;
  readonly timestampGranularity: "word";
  readonly timestampText: "original";
  /** @default true */
  readonly audioRetention?: boolean;
  readonly textBufferThreshold?: never;
  readonly maxBufferDelayMs?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly replacements?: never;
  readonly speed?: never;
  readonly inputType?: "text" | "markup";
}
/** Falcon 2 streams input/output. Gen2 remains available through /generate after streaming deprecation. */
export type TtsRequest = FalconText | FalconStreaming | Gen2Normalized | Gen2Original;

export interface MurfTimestamp {
  readonly kind: "word";
  readonly value: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
}
export interface MurfEnvelope {
  readonly correlation: "ordered" | "timeline";
  readonly correlationId?: string;
  readonly audio?: Uint8Array;
  readonly durationMs?: number;
  readonly timestamps: readonly MurfTimestamp[];
}
export interface DoneEvent {
  readonly event: "done";
  readonly remainingCharacters?: number;
  readonly warning?: string;
}
export interface ClearEvent { readonly event: "clear" }
export interface FlushEvent {
  readonly event: "flush";
  readonly correlationId: string;
  readonly inputGroupId: string;
}
export type SynthesisItem = Uint8Array | MurfEnvelope | ClearEvent | FlushEvent | DoneEvent;
