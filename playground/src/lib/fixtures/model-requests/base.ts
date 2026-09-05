export interface TtsRequest {
  /** Text. */
  readonly text: string | AsyncIterable<string>;
  /** Voice. */
  readonly voice: string;
  /** Model. */
  readonly model?: string;
  /** Language. */
  readonly language?: string;
  /** Speed. */
  readonly speed?: number;
  /** Output. */
  readonly output?: { readonly format: "mp3" | "pcm"; readonly sampleRateHz?: number; readonly bitRateBps?: number };
  /** Buffering. */
  readonly textBuffering?: boolean;
  /** Buffer thresholds. */
  readonly textBufferThresholds?: readonly number[];
  /** Timestamp granularity. */
  readonly timestampGranularity?: "character" | readonly "character"[];
  /** Timestamp text. */
  readonly timestampText?: "original" | "normalized";
}
