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
      /** Representation of each uncompressed sample. */
      readonly sampleEncoding?: "signed_integer_16" | "float_32";
      /** Byte order of each uncompressed sample. */
      readonly byteOrder?: "little_endian";
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: number;
      /** Representation of each uncompressed sample. */
      readonly sampleEncoding?: "signed_integer_16" | "float_32";
      /** Byte order of each uncompressed sample. */
      readonly byteOrder?: "little_endian";
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
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
      readonly bitRateBps?: number;
    };

/** Provider-neutral TTS request fields. */
export interface TtsClearCommand {
  readonly command: "clear";
}

export type TtsRequest = {
  /** Text to synthesize, supplied whole or incrementally when the provider supports streaming input. */
  readonly text?: string | AsyncIterable<string | TtsClearCommand>;
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
  /** Timing detail requested alongside audio, when supported by the provider. */
  readonly timestampGranularity?: "word";
  /** Whether incremental text waits for sentence boundaries or is synthesized immediately. */
  readonly segmentation?: "sentence" | "immediate";
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
