type StreamOutput =
  | { readonly format: "mp3"; readonly sampleRateHz: 8000 | 16000 | 24000 | 44100 | 48000; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz: 8000 | 16000 | 24000 | 44100 | 48000; readonly bitRateBps?: never }
  | { readonly format: "pcm"; readonly sampleRateHz: 8000 | 16000 | 24000 | 44100 | 48000; readonly bitRateBps?: never }
  | { readonly format: "flac"; readonly sampleRateHz: 8000 | 16000 | 24000 | 44100 | 48000; readonly bitRateBps?: never }
  | { readonly format: "alaw" | "mulaw"; readonly sampleRateHz: 8000; readonly bitRateBps?: never };

interface Common {
  readonly voice: string;
  readonly model: "falcon-2" | "gen2";
  readonly language?: string;
  readonly output: StreamOutput;
  /** @minimum 0.5 @maximum 1.5 */
  readonly speed?: number;
  readonly voiceVariant?: string;
  readonly deliveryVariation?: "stable" | "balanced" | "creative";
  readonly continuityId?: string;
  readonly streamingBuffer?: {
    /** @minimum 0 @maximum 1000 */
    readonly maxDelayMs?: number;
    /** @minimum 40 @maximum 160 */
    readonly characterThreshold?: number;
    readonly automatic?: never;
  };
}

interface SingleInput extends Common { readonly text: string }
interface StreamingInput extends Common {
  readonly text: AsyncIterable<
    string | { readonly command: "clear" } | { readonly command: "flush" }
  >;
}

export type TtsRequest = SingleInput | StreamingInput;

export interface TtsRequestWithTimestamps {
  readonly text: string;
  readonly voice: string;
  readonly model: "gen2";
  readonly language?: string;
  readonly output:
    | { readonly format: "mp3" | "wav" | "pcm" | "flac"; readonly sampleRateHz: 8000 | 24000 | 44100 | 48000; readonly bitRateBps?: never }
    | { readonly format: "alaw" | "mulaw"; readonly sampleRateHz: 8000; readonly bitRateBps?: never };
  /** @minimum 0.5 @maximum 1.5 */
  readonly speed?: number;
  readonly voiceVariant?: string;
  readonly deliveryVariation?: "stable" | "balanced" | "creative";
  readonly timestampGranularity?: "word";
}
