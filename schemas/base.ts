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
  /** Audio encoding format. */
  readonly format?: string;
  /** Audio sample rate in hertz. */
  readonly sampleRateHz?: number;
};
