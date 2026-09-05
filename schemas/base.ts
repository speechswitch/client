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
      /** Sample encoding inside the WAV container. */
      readonly sampleEncoding?: "signed_integer_16" | "float_32" | "mulaw" | "alaw";
      /** Byte order of each uncompressed sample. */
      readonly byteOrder?: "little_endian";
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: number;
      /** Representation of each uncompressed sample. */
      readonly sampleEncoding?: "signed_integer_16" | "signed_integer_32" | "float_32";
      /** Byte order of each uncompressed sample. */
      readonly byteOrder?: "little_endian" | "big_endian";
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz?: 48000;
      readonly bitRateBps?: never;
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
  /** Timing detail requested alongside audio; an array selects multiple supported kinds. */
  readonly timestampGranularity?: "word" | "phoneme" | readonly ("word" | "phoneme")[];
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
