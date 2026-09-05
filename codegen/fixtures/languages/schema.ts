export type TtsRequest = {
  /** An omitted property, explicit null, and false are different states. */
  readonly optional?: boolean | null;
  /** Required, but may explicitly be null. */
  readonly requiredNullable: string | null;
  /** Native audio bytes. */
  readonly bytes: Uint8Array;
  /** An unbounded integer. */
  readonly integer: bigint;
  /** An exact non-integer scalar choice. */
  readonly fractionalLiteral: 0.25;
  /** Literal backslash-u text followed by a NUL character. */
  readonly escapedLiteral: "\\u0000\u0000";
  /** Null is permitted inside this collection. */
  readonly items: readonly (string | null)[];
  /** Streaming text and a narrow command. */
  readonly text: AsyncIterable<string | { readonly command: "clear" }>;
  /** This field cannot be present. */
  readonly forbidden?: never;
};
