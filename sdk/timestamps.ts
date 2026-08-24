export type TimestampKind = "character" | "word" | "sentence" | "phoneme" | "viseme" | "ssml";

export interface Timestamp<Kind extends string = TimestampKind> {
  readonly kind: Kind;
  readonly value: string;
  readonly startTimeMs: number;
  readonly endTimeMs?: number;
  readonly source?: { readonly start: number; readonly end: number };
}

export type TimestampCorrelation = "chunk" | "ordered" | "timeline";

export type SynthesisEnvelope<Mark extends Timestamp<string> = Timestamp> =
  | {
      readonly correlation: "chunk";
      readonly audio: Uint8Array;
      readonly timestamps: readonly Mark[];
    }
  | {
      readonly correlation: "ordered" | "timeline";
      readonly audio?: Uint8Array;
      readonly timestamps: readonly Mark[];
    };

export interface SynthesisResult<Mark extends Timestamp<string> = Timestamp> {
  readonly audio: Uint8Array;
  readonly timestamps: readonly Mark[];
}
