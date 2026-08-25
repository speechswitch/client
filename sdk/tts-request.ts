/** Text accepted by an integration with a stream-input protocol. */
export type StreamingText = string | AsyncIterable<string>;

export async function* textChunks(text: StreamingText): AsyncIterableIterator<string> {
  if (typeof text === "string") {
    yield text;
    return;
  }
  yield* text;
}

/**
 * The normalized TTS vocabulary. It begins with the universal input and grows
 * only when an integration establishes another shared concept.
 */
export interface TtsRequestBase {
  /** Text to synthesize, supplied whole or incrementally when the provider supports streaming input. */
  readonly text?: StreamingText;
}

/** A capability object may only select and narrow normalized fields. */
export type TtsRequest<Capabilities extends Partial<TtsRequestBase>> =
  Capabilities extends Partial<TtsRequestBase>
    ? Exclude<keyof Capabilities, keyof TtsRequestBase> extends never
      ? { readonly [Key in keyof Capabilities]: Capabilities[Key] }
      : never
    : never;
