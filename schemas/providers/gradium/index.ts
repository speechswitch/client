interface Audio {
  readonly bitRateBps?: never;
}
interface Pcm extends Audio {
  readonly format: "pcm";
  /** @default 48000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
  readonly sampleEncoding?: "signed_integer_16";
  readonly byteOrder?: "little_endian";
}
interface Wav extends Audio {
  readonly format: "wav";
  readonly sampleRateHz?: 48000;
  readonly sampleEncoding?: "signed_integer_16";
  readonly byteOrder?: "little_endian";
}
interface Opus extends Audio {
  readonly format: "ogg_opus";
  readonly sampleRateHz?: never;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface Telephony extends Audio {
  readonly format: "mulaw" | "alaw";
  readonly sampleRateHz?: 8000;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
type Rule = "DateFrBe" | "DateFrCh" | "NumberEn" | "NumberFr" | "NumberFrBe" | "NumberFrCh" | "NumberDe" | "NumberEs" | "NumberPt"
  | "CurrencyEn" | "CurrencyFr" | "CurrencyFrBe" | "CurrencyFrCh" | "CurrencyDe" | "CurrencyEs" | "CurrencyPt"
  | "EmailEn" | "EmailFr" | "EmailDe" | "EmailEs" | "EmailPt" | "UrlEn" | "UrlFr" | "UrlDe" | "UrlEs" | "UrlPt"
  | "AlNum" | "AlNumEn" | "AlNumFr" | "AlNumDe" | "AlNumEs" | "AlNumPt";

export type TtsRequest = {
  /** Current production and preview aliases; both expose the same documented controls. @default "default" */
  readonly model?: "default" | "gradium-tts-beta";
  readonly text: string | AsyncIterable<string | { readonly command: "flush" }>;
  /** Library or existing custom voice ID. @pattern ^[\s\S]+$ */
  readonly voice: string;
  readonly output: Pcm | Wav | Opus | Telephony;
  /** Validation accepts 0–1.5; the recommended tuning range ends at 1.4. @minimum 0 @maximum 1.5 @default 0.7 */
  readonly temperature?: number;
  /** Validation accepts -5–5; the recommended tuning range is -4–4. @minimum -5 @maximum 5 @default 0 */
  readonly pacingBias?: number;
  readonly speed?: never;
  /** Validation accepts 1–10; the recommended tuning range is 1–4. @minimum 1 @maximum 10 @default 2 */
  readonly voiceGuidance?: number;
  readonly voiceSimilarity?: never;
  /** Omission uses the selected voice's language rules. */
  readonly textNormalization?: false | "auto"
    | { readonly locale: "en" | "fr" | "fr-be" | "fr-ch" | "de" | "es" | "pt"; readonly rules?: never }
    | {
        readonly locale?: never;
        /** @minItems 1 */
        readonly rules: readonly Rule[];
      };
  /** Existing pronunciation dictionary ID; selecting one uses WebSocket synthesis. @pattern ^[\s\S]+$ */
  readonly lexicon?: string;
  /** Native text segments, often but not always word-aligned. */
  readonly timestampGranularity?: "segment";
};

export type SegmentTimestamp = {
  readonly kind: "segment";
  readonly value: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
};

/** Audio and text arrive independently; their association is never inferred. */
export type TimelineOutput = {
  readonly correlation: "timeline";
  readonly correlationId?: string;
  readonly audio?: Uint8Array;
  readonly audioTiming?: { readonly startTimeMs: number; readonly endTimeMs: number };
  readonly timestamps: readonly SegmentTimestamp[];
};

export type SynthesisItem = Uint8Array | TimelineOutput;
