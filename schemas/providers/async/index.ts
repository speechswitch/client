type PcmOutput = {
  readonly container: "raw";
  readonly codec: "pcm";
  /** @integer @minimum 8000 @maximum 48000
   * @serializeAs settings sample_rate */
  readonly sampleRateHz: number;
  readonly sampleFormat?: "int16" | "float32";
  readonly byteOrder?: "little_endian";
  readonly bitRateBps?: never;
};
type WavOutput = {
  readonly container: "wav";
  readonly codec: "pcm";
  /** @integer @minimum 8000 @maximum 48000
   * @serializeAs settings sample_rate */
  readonly sampleRateHz: number;
  readonly sampleFormat?: "int16" | "float32";
  readonly byteOrder?: "little_endian";
  readonly bitRateBps?: never;
};
type Mp3Output = {
  readonly container?: never;
  readonly codec: "mp3";
  readonly sampleFormat?: never;
  readonly byteOrder?: never;
  /** @integer @minimum 8000 @maximum 48000
   * @serializeAs settings sample_rate */
  readonly sampleRateHz: number;
  /** @integer @minimum 32000 @maximum 320000
   * @serializeAs settings bit_rate */
  readonly bitRateBps?: number;
};
type MuLawOutput = {
  readonly container: "raw";
  readonly codec: "mulaw";
  readonly sampleFormat?: never;
  readonly byteOrder?: never;
  /** @integer @minimum 8000 @maximum 48000
   * @serializeAs settings sample_rate */
  readonly sampleRateHz: number;
  readonly bitRateBps?: never;
};

interface Voice {
  /** Existing catalog or custom voice ID; both use the same selection protocol. */
  readonly voice: string;
}
interface Legacy extends Voice {
  readonly model: "castleflow-1.0";
  /** @serializeAs settings language */
  readonly language?:
    | "en"
    | "fr"
    | "es"
    | "de"
    | "it"
    | "pt"
    | "ar"
    | "ru"
    | "ro"
    | "ja"
    | "he"
    | "hy"
    | "tr"
    | "hi"
    | "zh";
  /** @minimum 0.7 @maximum 2
   * @serializeAs settings speed_control */
  readonly speed?: number;
  /** Rounded to the nearest hundredth for Async's integer 0–100 scale. @minimum 0 @maximum 1 */
  readonly stability?: number;
}
interface Flash extends Voice {
  readonly model: "flash_v1.5";
  /** @serializeAs settings language */
  readonly language?: "en" | "fr" | "es" | "de" | "it" | "pt";
  readonly speed?: never;
  readonly stability?: never;
}
interface Pro extends Voice {
  readonly model: "pro_v1.0";
  /** @serializeAs settings language */
  readonly language?: "en";
  readonly speed?: never;
  readonly stability?: never;
}
interface Text {
  readonly text: string;
  /** @serializeAs settings output_format */
  readonly output: PcmOutput | WavOutput | Mp3Output | MuLawOutput;
  readonly timestampGranularity?: never;
  readonly segmentation?: never;
}
interface TimedText {
  readonly text: string;
  /** @serializeAs settings output_format */
  readonly output: PcmOutput | WavOutput | Mp3Output;
  readonly timestampGranularity: "word";
  readonly segmentation?: never;
}
interface IncrementalText {
  /** Each chunk is a text segment; the protocol requires a trailing space. */
  readonly text: AsyncIterable<string>;
  /** @serializeAs settings output_format */
  readonly output: PcmOutput | Mp3Output | MuLawOutput;
  readonly timestampGranularity?: never;
  readonly segmentation?: "sentence" | "immediate";
}
interface LegacyText extends Legacy, Text {}
interface FlashText extends Flash, Text {}
interface ProText extends Pro, Text {}
interface LegacyTimed extends Legacy, TimedText {}
interface FlashTimed extends Flash, TimedText {}
interface ProTimed extends Pro, TimedText {}
interface LegacyIncremental extends Legacy, IncrementalText {}
interface FlashIncremental extends Flash, IncrementalText {}
interface ProIncremental extends Pro, IncrementalText {}

export type TtsRequest =
  | LegacyText
  | FlashText
  | ProText
  | LegacyTimed
  | FlashTimed
  | ProTimed
  | LegacyIncremental
  | FlashIncremental
  | ProIncremental;

export type TtsRequestWithTimestamps = LegacyTimed | FlashTimed | ProTimed;
