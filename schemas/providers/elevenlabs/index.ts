type Output =
  | {
      readonly format: "mp3";
      readonly sampleRateHz: 22050;
      readonly bitRateBps: 32000;
    }
  | {
      readonly format: "mp3";
      readonly sampleRateHz: 24000;
      readonly bitRateBps: 48000;
    }
  | {
      readonly format: "mp3";
      readonly sampleRateHz: 44100;
      readonly bitRateBps: 32000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz: 48000;
      readonly bitRateBps: 32000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "wav";
      readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "alaw" | "mulaw";
      readonly sampleRateHz: 8000;
      readonly bitRateBps?: never;
    };

interface Common {
  readonly voice: string;
  readonly model: "eleven-v3" | "flash-v2" | "flash-v2.5" | "multilingual-v2";
  readonly language?: string;
  readonly output: Output;
  /** @minimum 0.7 @maximum 1.2 */
  readonly speed?: number;
  readonly textNormalization?: boolean;
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
  readonly voiceTuning?: {
    /** @minimum 0 @maximum 1 */
    readonly stability?: number;
    /** @minimum 0 @maximum 1 */
    readonly similarity?: number;
    /** @minimum 0 @maximum 1 */
    readonly style?: number;
    readonly speakerBoost?: boolean;
  };
}

interface SingleInput extends Common { readonly text: string }
interface StreamingInput extends Common {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
}

export type TtsRequest = SingleInput | StreamingInput;
export type TtsRequestWithTimestamps = SingleInput | StreamingInput;
