interface Settings {
  /** Respeecher Space realtime TTS, distinct from the Marketplace API. @default "realtime-tts" */
  readonly model?: "realtime-tts";
  /** Selects the English or Ukrainian realtime endpoint; native inline stress marks pass through unchanged. @default "en" */
  readonly language?: "en" | "uk";
  /** Existing catalog or provisioned custom voice ID. There is no public voice-cloning endpoint. @pattern ^[\s\S]+$ */
  readonly voice: string;
  /** Sampling overrides preserve the selected voice's defaults when omitted. @minimum 0 */
  readonly temperature?: number;
  /** Zero considers all tokens (native top_k=-1). @minimum 0 @integer */
  readonly topK?: number;
  /** @exclusiveMinimum 0 @maximum 1 */
  readonly topP?: number;
  /** @minimum 0 @maximum 1 */
  readonly minP?: number;
  /** @minimum 0 @maximum 2 */
  readonly presencePenalty?: number;
  /** @minimum 0 @maximum 2 */
  readonly frequencyPenalty?: number;
  /** @minimum 1 @maximum 2 */
  readonly repetitionPenalty?: number;
  /** @integer */
  readonly randomSeed?: number;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly timestampGranularity?: never;
  readonly timestampDelivery?: never;
}
interface Audio {
  /** @integer @minimum 1 @default 22050 */
  readonly sampleRateHz?: number;
  readonly channelCount?: 1;
  readonly bitRateBps?: never;
}
interface Pcm extends Audio {
  readonly format: "pcm";
  /** @default "float_32" */
  readonly sampleEncoding?: "float_32" | "signed_integer_16";
  readonly byteOrder?: "little_endian";
}
interface Mulaw extends Audio {
  readonly format: "mulaw";
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface Wave extends Audio {
  readonly format: "wav";
  readonly sampleEncoding?: "signed_integer_16";
  readonly byteOrder?: "little_endian";
}
export type TtsInput = string | { readonly command: "clear" } | { readonly command: "flush" };
interface WaveRequest extends Settings {
  /** The byte endpoint has an approximate 5000-character limit; use streaming output for longer input. */
  readonly text: string;
  readonly output: Wave;
}
interface StreamingRequest extends Settings {
  readonly text: string | AsyncIterable<TtsInput>;
  /** Omission selects mono float32 little-endian PCM at 22050 Hz. */
  readonly output?: Pcm | Mulaw;
}
export type TtsRequest = WaveRequest | StreamingRequest;
