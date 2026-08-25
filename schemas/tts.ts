export type StreamingText = string | AsyncIterable<string>;

/** Provider-neutral TTS request fields. */
export interface TtsRequestBase {
  /** Text to synthesize, supplied whole or incrementally when the provider supports streaming input. */
  readonly text?: StreamingText;
}

/** Selects and narrows normalized fields without adding vendor-specific fields. */
export type TtsRequest<Capabilities extends Partial<TtsRequestBase>> =
  Capabilities extends Partial<TtsRequestBase>
    ? Exclude<keyof Capabilities, keyof TtsRequestBase> extends never
      ? { readonly [Key in keyof Capabilities]: Capabilities[Key] }
      : never
    : never;
