export type TtsRequest =
  | {
      readonly model: "expressive";
      readonly text: string;
      readonly voice: string;
      readonly timestampGranularity?: never;
      readonly timestampText?: never;
    }
  | {
      readonly model: "expressive";
      readonly text: string;
      readonly voice: string;
      readonly timestampGranularity: "character" | readonly "character"[];
      readonly timestampText?: "original" | "normalized";
    };
