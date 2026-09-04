/** Provider-neutral audio output fields. */
export type TtsOutput =
  | {
      readonly format: "mp3" | "ogg_vorbis";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      /** Requested encoded audio bit rate. */
      readonly bitRateBps?: 32000 | 48000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "wav";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz?: 48000;
      readonly bitRateBps?: 32000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "alaw" | "mulaw";
      readonly sampleRateHz?: 8000 | 16000;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "flac" | "aac";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
      readonly bitRateBps?: number;
    };

/** Provider-neutral TTS request fields. */
export interface TtsClearCommand {
  readonly command: "clear";
}

export interface TtsFlushCommand {
  readonly command: "flush";
}

export type TtsRequest = {
  /** Text to synthesize, supplied whole or incrementally when the provider supports streaming input. */
  readonly text?: string | AsyncIterable<string | TtsClearCommand | TtsFlushCommand>;
  /** Provider voice identifier. */
  readonly voice?: string;
  /** Interpretation of the input text. */
  readonly inputType?: "text" | "ssml";
  /** Provider synthesis model or engine. */
  readonly model?: string;
  /** Language or locale used for synthesis. */
  readonly language?: string;
  /** Pronunciation lexicon name or names. */
  readonly lexicon?: string | readonly string[];
  /** Requested audio representation. */
  readonly output?: TtsOutput;
  /** Speech speed multiplier. */
  readonly speed?: number;
  /** Per-request controls for the selected voice's acoustic character. */
  readonly voiceTuning?: {
    /** Consistency versus expressive variation. */
    readonly stability?: number;
    /** Strength of similarity to the selected voice. */
    readonly similarity?: number;
    /** Exaggeration of the selected voice's speaking style. */
    readonly style?: number;
    /** Whether to spend additional compute reinforcing speaker similarity. */
    readonly speakerBoost?: boolean;
  };
  /** Whether written text is normalized to spoken form before synthesis. */
  readonly textNormalization?: boolean;
  /** Phrase-to-pronunciation substitutions. */
  readonly replacements?: readonly {
    readonly pattern: string;
    readonly replacement: string;
  }[];
  /** Degree to which synthesis quality may be traded for lower first-audio latency. */
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
};
