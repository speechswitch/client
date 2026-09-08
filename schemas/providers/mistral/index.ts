export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface PromptTokensDetails {
  readonly cachedTokens?: number;
  readonly audioTokens?: number;
  readonly messages?: readonly {
    readonly role: "system" | "user" | "assistant" | "tool";
    readonly totalTokens?: number | null;
    readonly truncated?: boolean;
    readonly usageCount?: number;
  }[];
}
export interface Usage {
  readonly promptTokens?: number;
  readonly completionTokens?: number | null;
  readonly totalTokens?: number;
  readonly promptAudioSeconds?: number | null;
  readonly requestCount?: number | null;
  readonly cachedTokens?: number | null;
  readonly promptTokensDetails?: PromptTokensDetails | null;
  /** Retain the separately documented singular legacy field without overriding its plural sibling. */
  readonly promptTokenDetails?: PromptTokensDetails | null;
  readonly completionTokensDetails?: { readonly reasoningTokens?: number } | null;
}
export interface DoneEvent { readonly event: "done"; readonly usage?: Usage }
export type SynthesisItem = Uint8Array | DoneEvent;

interface PcmOutput {
  readonly format: "pcm";
  /** Fixed by the service, not an arbitrary resampling option. @default 24000 */
  readonly sampleRateHz?: 24000;
  /** Documented native raw PCM representation. @default "float_32" */
  readonly sampleEncoding?: "float_32";
  /** @default "little_endian" */
  readonly byteOrder?: "little_endian";
  /** @default 1 */
  readonly channelCount?: 1;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
}
interface EncodedOutput {
  /** Native opus container/framing is unspecified; do not relabel it as raw or Ogg without evidence. */
  readonly format: "wav" | "mp3" | "flac" | "opus";
  readonly sampleRateHz?: never;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  readonly channelCount?: never;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
}

/** Whole-text input, streaming output. Saved voices and one-off reference audio are separate capabilities. */
export interface TtsRequest {
  readonly text: string;
  /** @default "voxtral-mini-tts-2603" */
  readonly model?: "voxtral-mini-tts-2603";
  /** Existing preset/custom voice identifier, passed unchanged. */
  readonly voice?: string;
  /** Complete encoded reference audio file; no transcript is required. */
  readonly referenceAudio?: Uint8Array;
  /** Omission selects lowest-latency float32 LE mono PCM at 24 kHz. */
  readonly output?: PcmOutput | EncodedOutput;
  readonly metadata?: { readonly [key: string]: JsonValue };
  readonly promptCacheKey?: string;
  readonly language?: never;
  readonly speed?: never;
  readonly emotion?: never;
  readonly instructions?: never;
  readonly timestampGranularity?: never;
  readonly timestampDelivery?: never;
  readonly inputType?: never;
  readonly referenceSamples?: never;
}
