type SampleRate = 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;

type Output =
  | {
      readonly format: "mp3";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: 32000 | 48000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: 24000 | 32000 | 48000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "wav";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "alaw" | "mulaw";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "flac";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: never;
    };

type StreamingOutput =
  | {
      readonly format: "mp3";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: 32000 | 48000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: 24000 | 32000 | 48000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "wav";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "alaw" | "mulaw";
      readonly sampleRateHz?: SampleRate;
      readonly bitRateBps?: never;
    };

interface SingleCommon {
  readonly text: string;
  readonly voice: string;
  readonly output: Output;
  readonly language?: string;
  readonly speed?: number;
  readonly textNormalization?: boolean;
  readonly audioEnhancement?: boolean;
  readonly contextTexts?: readonly string[];
  readonly timestampGranularity?: "character" | "word";
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
  readonly streamingBuffer?: never;
}

interface StreamingCommon {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly voice: string;
  readonly output: StreamingOutput;
  readonly language?: string;
  readonly speed?: number;
  readonly textNormalization?: boolean;
  readonly audioEnhancement?: never;
  readonly contextTexts?: never;
  readonly deliveryInstructions?: never;
  readonly timestampGranularity?: "character" | "word";
  readonly latencyOptimization?: "aggressive";
  readonly streamingBuffer?: {
    readonly maxDelayMs?: number;
    readonly characterThreshold?: number;
    readonly automatic?: boolean;
  };
}

interface Tts2Single extends SingleCommon {
  readonly model: "inworld-tts-2";
  readonly deliveryInstructions?: string;
  readonly deliveryVariation?: "stable" | "balanced" | "creative";
  readonly temperature?: never;
}

interface Tts2Streaming extends StreamingCommon {
  readonly model: "inworld-tts-2";
  readonly deliveryVariation?: "stable" | "balanced" | "creative";
  readonly temperature?: never;
}

interface LegacySingle extends SingleCommon {
  readonly model: "inworld-tts-1.5-max" | "inworld-tts-1.5-mini";
  readonly deliveryInstructions?: never;
  readonly deliveryVariation?: never;
  readonly temperature?: number;
}

interface LegacyStreaming extends StreamingCommon {
  readonly model: "inworld-tts-1.5-max" | "inworld-tts-1.5-mini";
  readonly deliveryVariation?: never;
  readonly temperature?: number;
}

export type TtsRequest = Tts2Single | Tts2Streaming | LegacySingle | LegacyStreaming;
export type TtsRequestWithTimestamps = Tts2Single | Tts2Streaming | LegacySingle | LegacyStreaming;
