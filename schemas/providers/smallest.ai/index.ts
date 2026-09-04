type Language =
  | "auto" | "en" | "hi" | "mr" | "kn" | "ta" | "bn" | "gu" | "te" | "ml" | "pa" | "or"
  | "es" | "de" | "fr" | "it" | "nl" | "sv" | "pt" | "ru" | "pl";
type ProLanguage = Language | "el" | "fi" | "no" | "ar" | "zh" | "id" | "ja" | "ko" | "ms" | "tr" | "vi";

type Output =
  | { readonly format: "mp3"; readonly sampleRateHz: 8000 | 16000 | 24000 | 44100; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz: 8000 | 16000 | 24000 | 44100; readonly bitRateBps?: never }
  | { readonly format: "pcm"; readonly sampleRateHz: 8000 | 16000 | 24000 | 44100; readonly sampleEncoding?: "signed_integer_16"; readonly bitRateBps?: never }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz: 8000 | 16000 | 24000 | 44100; readonly bitRateBps?: never };
type StreamingOutput = { readonly format: "pcm"; readonly sampleRateHz: 8000 | 16000 | 24000 | 44100; readonly sampleEncoding?: "signed_integer_16"; readonly bitRateBps?: never };

interface Controls {
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  /** @minimum 0.5 @maximum 2 */
  readonly speed?: number;
  readonly interpretMath?: boolean;
}
interface Standard extends Controls { readonly model: "lightning-v3.1"; readonly language?: Language; readonly numberReadingLanguage?: Language }
interface Pro extends Controls { readonly model: "lightning-v3.1-pro"; readonly language?: ProLanguage; readonly numberReadingLanguage?: ProLanguage }

interface Static {
  /** @minLength 1 @maxLength 8000 */
  readonly text: string;
  readonly output: Output;
  readonly latencyOptimization?: "none" | "aggressive";
  readonly continuityId?: never;
  readonly streamingBuffer?: never;
  readonly dictionarySelection?: { readonly projectId?: never; readonly dictionaryIds?: readonly string[] };
}
interface StreamingCommon {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly output: StreamingOutput;
  readonly latencyOptimization?: never;
  readonly dictionarySelection?: never;
}
interface LegacyStreaming extends StreamingCommon {
  readonly continuityId?: never;
  readonly streamingBuffer?: {
    /** @minimum 0 @maximum 1000 */
    readonly maxDelayMs?: number;
    readonly characterThreshold?: never;
    readonly automatic?: never;
    /** @minimum 0 @maximum 10000 */
    readonly completionDelayMs?: number;
  };
}
interface ContinuationStreaming extends StreamingCommon {
  readonly continuityId: string;
  readonly streamingBuffer?: {
    /** @minimum 0 @maximum 5000 */
    readonly maxDelayMs?: number;
    readonly characterThreshold?: never;
    readonly automatic?: never;
    /** @minimum 0 @maximum 10000 */
    readonly completionDelayMs?: number;
  };
}

interface StandardStatic extends Standard, Static {}
interface StandardLegacyStreaming extends Standard, LegacyStreaming {}
interface StandardContinuationStreaming extends Standard, ContinuationStreaming {}
interface ProStatic extends Pro, Static {}
interface ProLegacyStreaming extends Pro, LegacyStreaming {}
interface ProContinuationStreaming extends Pro, ContinuationStreaming {}
export type TtsRequest = StandardStatic | StandardLegacyStreaming | StandardContinuationStreaming | ProStatic | ProLegacyStreaming | ProContinuationStreaming;

interface TimestampControls {
  readonly voice: "meher" | "devansh" | "kartik" | "maithili" | "liam" | "avery";
  readonly voiceSource?: "catalog";
  readonly language?: ProLanguage;
  readonly output: StreamingOutput;
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly timestampGranularity?: "word";
  /** @minimum 0.5 @maximum 2 */
  readonly speed?: number;
  readonly interpretMath?: boolean;
  readonly dictionarySelection?: never;
  readonly latencyOptimization?: never;
}
interface LegacyTimestampControls extends TimestampControls, LegacyStreaming {}
interface ContinuationTimestampControls extends TimestampControls, ContinuationStreaming {}
interface StandardLegacyTimestamps extends LegacyTimestampControls { readonly model: "lightning-v3.1"; readonly language?: Language; readonly numberReadingLanguage?: Language }
interface StandardContinuationTimestamps extends ContinuationTimestampControls { readonly model: "lightning-v3.1"; readonly language?: Language; readonly numberReadingLanguage?: Language }
interface ProLegacyTimestamps extends LegacyTimestampControls { readonly model: "lightning-v3.1-pro"; readonly language?: ProLanguage; readonly numberReadingLanguage?: ProLanguage }
interface ProContinuationTimestamps extends ContinuationTimestampControls { readonly model: "lightning-v3.1-pro"; readonly language?: ProLanguage; readonly numberReadingLanguage?: ProLanguage }
export type TtsRequestWithTimestamps = StandardLegacyTimestamps | StandardContinuationTimestamps | ProLegacyTimestamps | ProContinuationTimestamps;
