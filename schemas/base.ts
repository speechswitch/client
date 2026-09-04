/** Provider-neutral audio output fields. */
export type TtsOutput =
  | {
      readonly format: "mp3" | "ogg_vorbis";
      readonly sampleRateHz?: number;
      /** Requested encoded audio bit rate. */
      readonly bitRateBps?: 32000 | 48000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "wav";
      readonly sampleRateHz?: number;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: number;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz?: number;
      readonly bitRateBps?: 24000 | 32000 | 48000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "alaw" | "mulaw";
      readonly sampleRateHz?: number;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "flac" | "aac";
      readonly sampleRateHz?: number;
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
  /** Provider-defined sub-variant or style identifier for the selected voice. */
  readonly voiceVariant?: string;
  /** Whether the selected voice comes from the provider catalog or the caller's custom voices. */
  readonly voiceSource?: "catalog" | "custom";
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
  /** Natural-language direction for how the speech should be delivered. */
  readonly deliveryInstructions?: string;
  /** Degree of variation in how the requested delivery is performed. */
  readonly deliveryVariation?: "stable" | "balanced" | "creative";
  /** Silence appended after the spoken input, in seconds. */
  readonly trailingSilenceSeconds?: number;
  /** Sampling temperature controlling variation in generated speech. */
  readonly temperature?: number;
  /** Classifier-free guidance strength used by a generative speech model. */
  readonly guidanceScale?: number;
  /** Maximum number of model tokens generated for the requested speech. */
  readonly maxOutputTokens?: number;
  /** Identifier used to continue speech style and prosody across synthesis requests. */
  readonly continuityId?: string;
  /** Output gain adjustment in decibels. */
  readonly volumeDb?: number;
  /** Speaking pitch adjustment in semitones. */
  readonly pitchSemitones?: number;
  /** Whether output loudness is normalized. */
  readonly loudnessNormalization?: boolean;
  /** Whether the provider should apply additional audio cleanup or enhancement. */
  readonly audioEnhancement?: boolean;
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
  /** Earlier synthesized text supplied as context for the current request. */
  readonly contextTexts?: readonly string[];
  /** Pronunciation dictionaries selected from an optional provider project. */
  readonly dictionarySelection?: {
    readonly projectId?: string | number;
    readonly dictionaryIds?: readonly (string | number)[];
  };
  /** Requested alignment unit when timestamped synthesis is used. */
  readonly timestampGranularity?: "character" | "word" | "sentence" | "phoneme" | "viseme";
  /** Phrase-to-pronunciation substitutions. */
  readonly replacements?: readonly {
    readonly pattern: string;
    readonly replacement: string;
  }[];
  /** Degree to which synthesis quality may be traded for lower first-audio latency. */
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
  /** Server-side buffering controls for incrementally supplied text. */
  readonly streamingBuffer?: {
    /** Maximum time to retain text before starting synthesis. */
    readonly maxDelayMs?: number;
    /** Character count that automatically starts synthesis. */
    readonly characterThreshold?: number;
    /** Whether the provider should choose flush boundaries automatically. */
    readonly automatic?: boolean;
  };
};
