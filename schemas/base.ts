/** Provider-neutral audio output fields. */
export type TtsOutput =
  | {
      readonly format: "mp3" | "ogg_vorbis";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: 8000 | 16000;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz?: 48000;
    }
  | {
      readonly format: "alaw" | "mulaw";
      readonly sampleRateHz?: 8000;
    };

/** Provider-neutral TTS request fields. */
export type TtsRequest = {
  /** Text to synthesize, supplied whole or incrementally when the provider supports streaming input. */
  readonly text?: string | AsyncIterable<string>;
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
};
