type Output =
  | {
      readonly format: "wav";
      readonly sampleRateHz: 8000 | 16000 | 24000 | 32000 | 44100;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz: 8000 | 16000 | 24000 | 32000 | 44100;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "mp3";
      readonly sampleRateHz: 32000 | 44100;
      readonly bitRateBps: 64000 | 128000 | 192000;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz: 48000;
      readonly bitRateBps?: 24000 | 32000 | 48000 | 64000;
    };

interface Common {
  readonly voice: string;
  readonly model: "s1" | "s2-pro";
  readonly output: Output;
  /** @minimum 0.5 @maximum 2 */
  readonly speed?: number;
  readonly volumeDb?: number;
  readonly loudnessNormalization?: boolean;
  readonly textNormalization?: boolean;
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
}

interface SingleInput extends Common { readonly text: string }
interface StreamingInput extends Common {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
}

export type TtsRequest = SingleInput | StreamingInput;
export type TtsRequestWithTimestamps = SingleInput;
