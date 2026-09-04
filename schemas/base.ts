/** Provider-neutral audio output fields. */
export type TtsOutput =
  | {
      readonly format: "mp3" | "ogg_vorbis";
      readonly sampleRateHz?: number;
      /** Requested encoded audio bit rate. */
      readonly bitRateBps?: number;
    }
  | {
      readonly format: "wav";
      readonly sampleRateHz?: number;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: number;
      /** Representation of each raw PCM sample. */
      readonly sampleEncoding?: "signed_integer_16" | "float_32";
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "ogg_opus" | "webm_opus" | "opus";
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
  /** Reference audio used to derive a voice for this synthesis request. */
  readonly referenceAudio?: Uint8Array;
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
  /** Language used to read numbers independently of the synthesis language. */
  readonly numberReadingLanguage?: string;
  /** Whether written mathematical operators should be interpreted as spoken math. */
  readonly interpretMath?: boolean;
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
  /** Seed controlling deterministic model sampling, where supported. */
  readonly randomSeed?: number;
  /** Minimum token probability retained during model sampling. */
  readonly minimumTokenProbability?: number;
  /** Cumulative probability mass retained during nucleus sampling. */
  readonly topProbabilityMass?: number;
  /** Maximum number of candidate tokens retained during sampling. */
  readonly topTokenCount?: number;
  /** Penalty applied to repeated model tokens. */
  readonly repetitionPenalty?: number;
  /** Penalty applied when a model token has already occurred. */
  readonly presencePenalty?: number;
  /** Penalty scaled by how frequently a model token has occurred. */
  readonly frequencyPenalty?: number;
  /** Classifier-free guidance strength used by a generative speech model. */
  readonly guidanceScale?: number;
  /** Maximum number of model tokens generated for the requested speech. */
  readonly maxOutputTokens?: number;
  /** Identifier used to continue speech style and prosody across synthesis requests. */
  readonly continuityId?: string;
  /** Output gain adjustment in decibels. */
  readonly volumeDb?: number;
  /** Speech volume multiplier, where 1 preserves the provider's default level. */
  readonly volumeScale?: number;
  /** Speaking pitch adjustment in semitones. */
  readonly pitchSemitones?: number;
  /** Requested speaking emotion or affect. */
  readonly emotion?: string;
  /** Strength of the requested emotion or affect. */
  readonly emotionIntensity?: number;
  /** Independently weighted emotional components blended into the delivery. */
  readonly emotionBlend?: {
    readonly anger?: number;
    readonly happiness?: number;
    readonly neutral?: number;
    readonly sadness?: number;
    readonly contextual?: number;
  };
  /** Whether delivery should be biased toward emotion inferred from the input text. */
  readonly textEmotionBias?: boolean;
  /** Whether the provider should increase expressive variation. */
  readonly expressivenessEnhancement?: boolean;
  /** Text surrounding the spoken input, used to infer its delivery. */
  readonly surroundingContext?: { readonly previous?: string; readonly next?: string };
  /** Absolute output loudness target in LUFS. */
  readonly targetLoudnessLufs?: number;
  /** Whether output loudness is normalized. */
  readonly loudnessNormalization?: boolean;
  /** Whether the provider should apply additional audio cleanup or enhancement. */
  readonly audioEnhancement?: boolean;
  /** Whether silence is removed from reference audio before voice conditioning. */
  readonly referenceAudioTrimming?: boolean;
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
    readonly version?: string | number;
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
    /** Delay after the last audio chunk before the provider reports completion. */
    readonly completionDelayMs?: number;
  };
  /** Strategy used to decide when incrementally supplied text is synthesized. */
  readonly segmentation?: "immediate" | "sentence" | "explicit";
  /** Whether provider-specific inline pause markup is interpreted. */
  readonly inlinePauses?: boolean;
  /** Whether provider-specific inline phoneme markup is interpreted. */
  readonly inlinePhonemes?: boolean;
  /** Speed factors applied to provider-specific marked spans in input order. */
  readonly inlineSpeedFactors?: readonly number[];
  /** Ordered speech and silence segments composed into one output. */
  readonly segments?: readonly (
    | {
        readonly text: string;
        readonly voice: string;
        readonly model: string;
        readonly language?: string;
        readonly output: TtsOutput;
        readonly speed?: number;
        readonly volumeScale?: number;
        readonly pitchSemitones?: number;
        readonly targetLoudnessLufs?: number;
        readonly emotion?: string;
        readonly emotionIntensity?: number;
        readonly emotionBlend?: {
          readonly anger?: number;
          readonly happiness?: number;
          readonly neutral?: number;
          readonly sadness?: number;
          readonly contextual?: number;
        };
        readonly surroundingContext?: { readonly previous?: string; readonly next?: string };
        readonly randomSeed?: number;
      }
    | { readonly pauseSeconds: number }
  )[];
};
