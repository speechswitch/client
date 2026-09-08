export type TtsRequest = {
  /** An omitted property, explicit null, and false are different states. */
  readonly optional?: boolean | null;
  /** Required, but may explicitly be null. */
  readonly requiredNullable: string | null;
  /** Native audio bytes. */
  readonly bytes: Uint8Array;
  /** No values may be supplied. */
  readonly empty: readonly [];
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

export type OptionalInputRequest = {
  /** Only an actual producer enables the consumed-item checker. */
  readonly text?: string | AsyncIterable<string | { readonly command: "clear" }>;
};

/** Accumulated diagnostics use canonical names across language field conventions. */
export type DiagnosticRequest = {
  readonly choice: string | { readonly mode: "pcm" };
  /** @minItems 1 @maxItems 2 */
  readonly labels: readonly string[];
  readonly metadata?: { readonly [key: string]: number };
  /** @integer @minimum 1 @maximum 10 */
  readonly sampleRateHz: number;
  readonly text?: AsyncIterable<string | {
    readonly command: "update";
    /** @minimum 0.5 @maximum 2 */
    readonly speed: number;
  }>;
};
