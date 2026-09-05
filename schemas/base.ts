/** Provider-neutral audio output fields. */
export type TtsOutput = {
  /** Audio format or container. */
  readonly format: "mp3" | "ogg_vorbis" | "wav" | "pcm" | "ogg_opus" | "alaw" | "mulaw" | "flac" | "aac";
  /** Requested audio sample rate. */
  readonly sampleRateHz?: number;
  /** Requested encoded audio bit rate. */
  readonly bitRateBps?: number;
  /** Representation of samples within PCM or a container such as WAV. */
  readonly sampleEncoding?: "signed_integer_16" | "signed_integer_32" | "float_32" | "mulaw" | "alaw";
  /** Byte order of each uncompressed sample. */
  readonly byteOrder?: "little_endian" | "big_endian";
};

/** Provider-neutral TTS request fields. */
export interface TtsClearCommand {
  readonly command: "clear";
}

export interface TtsFlushCommand {
  readonly command: "flush";
}

export interface TtsUpdateCommand {
  readonly command: "update";
  /** Replace session pronunciation substitutions; an empty array removes them. */
  readonly replacements: readonly { readonly pattern: string; readonly replacement: string }[];
}

export type TtsRequest = {
  /** Text to synthesize, supplied whole or incrementally when the provider supports streaming input. */
  readonly text?: string | AsyncIterable<string | TtsClearCommand | TtsFlushCommand | TtsUpdateCommand>;
  /** Provider voice identifier. */
  readonly voice?: string;
  /** Reference audio used for voice conditioning, independent of an existing voice identifier. */
  readonly referenceAudio?: Uint8Array;
  /** Reference performance identifier used to guide delivery independently of voice identity. */
  readonly deliveryReference?: string;
  /** Interpretation of the input text. */
  readonly inputType?: "text" | "ssml";
  /** Provider synthesis model or engine. */
  readonly model?: string;
  /** Opt this request out of the provider's model-improvement program. May affect pricing. */
  readonly modelImprovementOptOut?: boolean;
  /** Usage-reporting labels attached to this request. */
  readonly tags?: readonly string[];
  /** Language or locale used for synthesis. */
  readonly language?: string;
  /** Pronunciation lexicon name or names. */
  readonly lexicon?: string | readonly string[];
  /** Requested audio representation. */
  readonly output?: TtsOutput;
  /** Speech speed multiplier. */
  readonly speed?: number;
  /** Target synthesized duration in milliseconds; some providers exclude a simultaneous speed multiplier. */
  readonly targetDurationMs?: number;
  /** Variation within the generated delivery, from 0 to 1. */
  readonly deliveryVariance?: number;
  /** Sampling temperature, from 0 to 1. */
  readonly temperature?: number;
  /** Seed used by providers that support deterministic sampling. */
  readonly randomSeed?: number;
  /** Strengthen the influence of the voice prompt on generated speech. */
  readonly voiceBoost?: boolean;
  /** Enable extended duration stretching of generated speech. */
  readonly durationStretching?: boolean;
  /** Scheduling priority, independent of synthesis quality/latency tradeoffs. */
  readonly processingPriority?: "standard" | "realtime";
  /** Automatically adjust output gain levels. */
  readonly automaticGainControl?: boolean;
  /** Speaker gender used for language-specific synthesis decisions. */
  readonly speakerGender?: "male" | "female";
  /** Blend a base accent with a target accent; the ratio is 0 for the base and 1 for the target. */
  readonly accentBlend?: {
    readonly baseLocale: string;
    readonly targetLocale: string;
    readonly ratio: number;
  };
  /** Timing detail requested alongside audio; an array selects multiple supported kinds. */
  readonly timestampGranularity?: "character" | "word" | "phoneme" | readonly ("word" | "phoneme")[];
  /** Voice consistency, from 0 (more expressive) to 1 (more stable). */
  readonly stability?: number;
  /** Output volume multiplier. */
  readonly volumeScale?: number;
  /** Requested emotional delivery. */
  readonly emotion?: string;
  /** Accent to use independently of the synthesis language. */
  readonly accent?: string;
  /** Maximum provider text-buffering delay before generation begins. */
  readonly maxBufferDelayMs?: number;
  /** Whether timestamps describe the original or normalized spoken text. */
  readonly timestampText?: "original" | "normalized";
  /** Apply provider audio cleanup and loudness enhancement to generated output. */
  readonly audioEnhancement?: boolean;
  /** Improve pronunciation of names, brands, and other named entities. */
  readonly namedEntityPronunciationEnhancement?: boolean;
  /** Clean up the source recording behind the selected voice. */
  readonly referenceAudioEnhancement?: boolean;
  /** Preserve the source voice's accent in generated speech. */
  readonly accentPreservation?: boolean;
  /** Idle time before flushing trailing incomplete text; complete sentences may flush sooner. */
  readonly textFlushDelayMs?: number;
  /** Number of inference steps used to generate speech. */
  readonly inferenceSteps?: number;
  /** Whether incremental text waits for sentence boundaries or is synthesized immediately. */
  readonly segmentation?: "sentence" | "immediate";
  /** Whether written text is normalized to spoken form before synthesis. */
  readonly textNormalization?: boolean | { readonly locale: string };
  /** Phrase-to-pronunciation substitutions. */
  readonly replacements?: readonly {
    readonly pattern: string;
    readonly replacement: string;
  }[];
  /** Degree to which synthesis quality may be traded for lower first-audio latency. */
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
};
