/** Valid provider-neutral combinations of audio encoding and container. */
export type TtsOutput =
  | {
      /** Audio encoding. */
      readonly codec: "mp3";
      /** Native framing is fixed for this codec. */
      readonly container?: never;
      /** PCM sample representation does not apply to compressed audio. */
      readonly sampleFormat?: never;
      /** Requested audio sample rate. */
      readonly sampleRateHz?: number;
      /** Requested encoded audio bit rate. */
      readonly bitRateBps?: number;
    }
  | {
      /** Audio encoding. */
      readonly codec: "vorbis" | "opus";
      /** Wrapper containing encoded audio packets. */
      readonly container: "ogg";
      /** PCM sample representation does not apply to compressed audio. */
      readonly sampleFormat?: never;
      /** Requested audio sample rate. */
      readonly sampleRateHz?: number;
      /** Requested encoded audio bit rate. */
      readonly bitRateBps?: number;
    }
  | {
      /** Uncompressed audio encoding. */
      readonly codec: "pcm";
      /** Raw samples or a WAV wrapper. */
      readonly container: "raw" | "wav";
      /** Representation of each PCM sample. */
      readonly sampleFormat?: "int16" | "float32";
      /** Byte order of each uncompressed sample. */
      readonly byteOrder?: "little_endian";
      /** Requested audio sample rate. */
      readonly sampleRateHz?: number;
      /** PCM bit rate follows the sample representation and sample rate. */
      readonly bitRateBps?: never;
    }
  | {
      /** G.711 audio encoding. */
      readonly codec: "alaw" | "mulaw";
      /** Raw G.711 samples. */
      readonly container: "raw";
      /** PCM sample representation does not apply to G.711. */
      readonly sampleFormat?: never;
      /** Requested audio sample rate. */
      readonly sampleRateHz?: number;
      /** G.711 uses a fixed number of bits per sample. */
      readonly bitRateBps?: never;
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
  /** Replace session pronunciation substitutions; an empty object removes them. */
  readonly replacements: Readonly<Record<string, string>>;
}

export type TtsRequest = {
  /** Text to synthesize, supplied whole or incrementally when the provider supports streaming input. */
  readonly text?:
    | string
    | AsyncIterable<string | TtsClearCommand | TtsFlushCommand | TtsUpdateCommand>;
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
  /** Timing detail requested alongside audio. */
  readonly timestampGranularity?: "character" | "word";
  /** Voice consistency, from 0 (more expressive) to 1 (more stable). */
  readonly stability?: number;
  /** Whether incremental text waits for sentence boundaries or is synthesized immediately. */
  readonly segmentation?: "sentence" | "immediate";
  /** Whether written text is normalized to spoken form before synthesis. */
  readonly textNormalization?: boolean;
  /** Phrase-to-pronunciation substitutions. */
  readonly replacements?: Readonly<Record<string, string>>;
  /** Degree to which synthesis quality may be traded for lower first-audio latency. */
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
};
