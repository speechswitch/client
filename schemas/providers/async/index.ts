type Language = "en" | "fr" | "es" | "de" | "it" | "pt" | "ar" | "ru" | "ro" | "ja" | "he" | "hy" | "tr" | "hi" | "zh";
type ModernLanguage = "en" | "fr" | "es" | "de" | "it" | "pt";

type PcmOutput = {
  readonly format: "pcm";
  /** @minimum 8000 @maximum 48000 */ readonly sampleRateHz: number;
  readonly sampleEncoding?: "signed_integer_16" | "float_32";
  readonly bitRateBps?: never;
};
type Mp3Output = {
  readonly format: "mp3";
  /** @minimum 8000 @maximum 48000 */ readonly sampleRateHz: number;
  /** @minimum 32000 @maximum 320000 */ readonly bitRateBps?: number;
};
type WavOutput = {
  readonly format: "wav";
  /** @minimum 8000 @maximum 48000 */ readonly sampleRateHz: number;
  readonly bitRateBps?: never;
};
type MuLawOutput = {
  readonly format: "mulaw";
  /** @minimum 8000 @maximum 48000 */ readonly sampleRateHz: number;
  readonly bitRateBps?: never;
};
type StaticOutput = PcmOutput | Mp3Output | WavOutput;
type StreamingOutput = PcmOutput | Mp3Output | MuLawOutput;

interface Common {
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
}
interface LegacyControls extends Common {
  readonly model: "castleflow-1.0";
  readonly language?: Language;
  /** @minimum 0.7 @maximum 2 */ readonly speed?: number;
  readonly voiceTuning?: {
    /** @minimum 0 @maximum 100 */ readonly stability?: number;
    readonly similarity?: never;
    readonly style?: never;
    readonly speakerBoost?: never;
  };
}
interface FlashControls extends Common {
  readonly model: "flash_v1.5";
  readonly language?: ModernLanguage;
  readonly speed?: never;
  readonly voiceTuning?: never;
}
interface ProControls extends Common {
  readonly model: "pro_v1.0";
  readonly language?: "en";
  readonly speed?: never;
  readonly voiceTuning?: never;
}
type Controls = LegacyControls | FlashControls | ProControls;

interface BufferedInput {
  readonly text: string;
  readonly output: StaticOutput;
  readonly latencyOptimization: "none";
  readonly segmentation?: never;
}
interface StreamedInput {
  readonly text: string;
  readonly output: StreamingOutput;
  readonly latencyOptimization?: "aggressive";
  readonly segmentation?: never;
}
interface IncrementalInput {
  readonly text: AsyncIterable<string>;
  readonly output: StreamingOutput;
  readonly latencyOptimization?: never;
  readonly segmentation?: "sentence" | "immediate";
}

interface LegacyBuffered extends LegacyControls, BufferedInput {}
interface LegacyStreamed extends LegacyControls, StreamedInput {}
interface LegacyIncremental extends LegacyControls, IncrementalInput {}
interface FlashBuffered extends FlashControls, BufferedInput {}
interface FlashStreamed extends FlashControls, StreamedInput {}
interface FlashIncremental extends FlashControls, IncrementalInput {}
interface ProBuffered extends ProControls, BufferedInput {}
interface ProStreamed extends ProControls, StreamedInput {}
interface ProIncremental extends ProControls, IncrementalInput {}
export type TtsRequest = LegacyBuffered | LegacyStreamed | LegacyIncremental | FlashBuffered | FlashStreamed | FlashIncremental | ProBuffered | ProStreamed | ProIncremental;

interface TimestampInput {
  readonly text: string;
  readonly output: StaticOutput;
  readonly timestampGranularity?: "word";
  readonly latencyOptimization?: never;
  readonly segmentation?: never;
}
interface LegacyTimestamped extends LegacyControls, TimestampInput {}
interface FlashTimestamped extends FlashControls, TimestampInput {}
interface ProTimestamped extends ProControls, TimestampInput {}
export type TtsRequestWithTimestamps = LegacyTimestamped | FlashTimestamped | ProTimestamped;
