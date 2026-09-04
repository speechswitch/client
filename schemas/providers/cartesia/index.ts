type Model = "sonic-3" | "sonic-3.5";
type Language = "en" | "fr" | "de" | "es" | "pt" | "zh" | "ja" | "hi" | "it" | "ko" | "nl" | "pl" | "ru" | "sv" | "tr" | "tl" | "bg" | "ro" | "ar" | "cs" | "el" | "fi" | "hr" | "ms" | "sk" | "da" | "ta" | "uk" | "hu" | "no" | "vi" | "bn" | "th" | "he" | "ka" | "id" | "te" | "gu" | "kn" | "ml" | "mr" | "pa" | "or" | "ur";
type SampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
type Emotion = "neutral" | "happy" | "excited" | "enthusiastic" | "elated" | "euphoric" | "triumphant" | "amazed" | "surprised" | "flirtatious" | "curious" | "content" | "peaceful" | "serene" | "calm" | "grateful" | "affectionate" | "trust" | "sympathetic" | "anticipation" | "mysterious" | "angry" | "mad" | "outraged" | "frustrated" | "agitated" | "threatened" | "disgusted" | "contempt" | "envious" | "sarcastic" | "ironic" | "sad" | "dejected" | "melancholic" | "disappointed" | "hurt" | "guilty" | "bored" | "tired" | "rejected" | "nostalgic" | "wistful" | "apologetic" | "hesitant" | "insecure" | "confused" | "resigned" | "anxious" | "panicked" | "alarmed" | "scared" | "proud" | "confident" | "distant" | "skeptical" | "contemplative" | "determined";
type LiveEmotion = "neutral" | "calm" | "angry" | "content" | "sad";

type StaticOutput =
  | { readonly format: "mp3"; readonly sampleRateHz: SampleRate; readonly bitRateBps: 32000 | 64000 | 96000 | 128000 | 192000 }
  | { readonly format: "wav"; readonly sampleRateHz: SampleRate; readonly bitRateBps?: never }
  | { readonly format: "pcm"; readonly sampleRateHz: SampleRate; readonly sampleEncoding: "signed_integer_16" | "float_32"; readonly byteOrder: "little_endian"; readonly bitRateBps?: never }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz: SampleRate; readonly bitRateBps?: never };
type LiveOutput =
  | { readonly format: "pcm"; readonly sampleRateHz: SampleRate; readonly sampleEncoding: "signed_integer_16" | "float_32"; readonly byteOrder: "little_endian"; readonly bitRateBps?: never }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz: SampleRate; readonly bitRateBps?: never };

interface Common {
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly model: Model;
  readonly accent?: string;
  /** @minimum 0.6 @maximum 1.5 */ readonly speed?: number;
  /** @minimum 0.5 @maximum 2 */ readonly volumeScale?: number;
  readonly emotion?: Emotion;
  readonly textNormalization?: boolean | { readonly locale: string };
  readonly dictionarySelection?: {
    readonly projectId?: never;
    readonly dictionaryIds?: readonly string[];
    readonly version?: never;
  };
  readonly continuityId?: string;
  readonly normalizedTimestamps?: never;
}

interface StaticLanguage extends Common {
  readonly text: string;
  readonly output: StaticOutput;
  readonly language?: Language;
  readonly locale?: never;
  readonly timestampGranularity?: never;
  readonly streamingBuffer?: never;
  readonly segmentation?: never;
}
interface StaticLocale extends Common {
  readonly text: string;
  readonly output: StaticOutput;
  readonly language?: never;
  readonly locale: string;
  readonly timestampGranularity?: never;
  readonly streamingBuffer?: never;
  readonly segmentation?: never;
}
interface StreamingLanguage extends Common {
  readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>;
  readonly output: LiveOutput;
  readonly language?: Language;
  readonly locale?: never;
  readonly emotion?: LiveEmotion;
  readonly timestampGranularity?: never;
  readonly streamingBuffer?: { /** @minimum 0 @maximum 5000 */ readonly maxDelayMs?: number; readonly characterThreshold?: never; readonly automatic?: never; readonly completionDelayMs?: never };
  readonly segmentation?: "immediate" | "explicit";
}
interface StreamingLocale extends Common {
  readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>;
  readonly output: LiveOutput;
  readonly language?: never;
  readonly locale: string;
  readonly emotion?: LiveEmotion;
  readonly timestampGranularity?: never;
  readonly streamingBuffer?: { /** @minimum 0 @maximum 5000 */ readonly maxDelayMs?: number; readonly characterThreshold?: never; readonly automatic?: never; readonly completionDelayMs?: never };
  readonly segmentation?: "immediate" | "explicit";
}

export type TtsRequest = StaticLanguage | StaticLocale | StreamingLanguage | StreamingLocale;

interface TimestampCommon {
  readonly text: string | AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>;
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly model: Model;
  readonly output: LiveOutput;
  readonly accent?: string;
  /** @minimum 0.6 @maximum 1.5 */ readonly speed?: number;
  /** @minimum 0.5 @maximum 2 */ readonly volumeScale?: number;
  readonly emotion?: Emotion;
  readonly textNormalization?: boolean | { readonly locale: string };
  readonly dictionarySelection?: { readonly projectId?: never; readonly dictionaryIds?: readonly string[]; readonly version?: never };
  readonly continuityId?: string;
  readonly timestampGranularity: "word" | "phoneme";
  readonly normalizedTimestamps?: boolean;
  readonly streamingBuffer?: { /** @minimum 0 @maximum 5000 */ readonly maxDelayMs?: number; readonly characterThreshold?: never; readonly automatic?: never; readonly completionDelayMs?: never };
  readonly segmentation?: "immediate" | "explicit";
}
interface TimestampLanguage extends TimestampCommon { readonly language?: Language; readonly locale?: never }
interface TimestampLocale extends TimestampCommon { readonly language?: never; readonly locale: string }
export type TtsRequestWithTimestamps = TimestampLanguage | TimestampLocale;
