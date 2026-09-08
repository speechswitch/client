import type { Timestamp } from "../../timestamps.ts";

type LegacyLanguage = "auto" | "ar" | "bg" | "cs" | "da" | "de" | "el" | "en" | "fi" | "fr" | "hr" | "id" | "it" | "ja" | "ko" | "ms" | "nl" | "pl" | "pt" | "ro" | "ru" | "sk" | "es" | "sv" | "ta" | "tl" | "uk" | "zh";
type ModernLanguage = LegacyLanguage | "bn" | "hi" | "hu" | "nan" | "no" | "pa" | "th" | "tr" | "vi" | "yue";
type Granularity = "word" | "character" | readonly ("word" | "character")[];
interface Wave {
  readonly format: "wav";
  /** Streaming uses 32 kHz; requesting 44.1 kHz selects the ordinary endpoint. @default 32000 */
  readonly sampleRateHz?: 32000 | 44100;
  /** @default "signed_integer_16" */
  readonly sampleEncoding?: "signed_integer_16";
  /** @default "little_endian" */
  readonly byteOrder?: "little_endian";
  /** @default 1 */
  readonly channelCount?: 1;
  readonly bitRateBps?: never;
}
interface FullWave extends Wave {
  /** Ordinary, timestamped and composed audio use 44.1 kHz. @default 44100 */
  readonly sampleRateHz?: 44100;
}
interface Mp3 {
  readonly format: "mp3";
  /** @default 44100 */
  readonly sampleRateHz?: 44100;
  /** @default 320000 */
  readonly bitRateBps?: 320000;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface Settings {
  /** Built-in tc_ or existing custom uc_ voice ID; no cloning request is made by synthesize. @pattern ^(tc|uc)_.+$ */
  readonly voice: string;
  /** Whole text only. Streaming output does not imply incremental text input. @maxLength 2000 @pattern ^[\s\S]+$ */
  readonly text: string;
  /** @minimum 0.5 @maximum 2 @default 1 */
  readonly speed?: number;
  /** @integer @minimum -12 @maximum 12 @default 0 */
  readonly pitchSemitones?: number;
  /** @integer @minimum 0 @maximum 4294967295 */
  readonly randomSeed?: number;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}
interface Legacy extends Settings {
  readonly model: "ssfm-v21";
  /** @default "auto" */
  readonly language?: LegacyLanguage;
  /** @default "normal" */
  readonly emotion?: "normal" | "happy" | "sad" | "angry";
  /** @minimum 0 @maximum 2 @default 1 */
  readonly emotionIntensity?: number;
  readonly contextBefore?: never;
  readonly contextAfter?: never;
}
interface ModernPreset extends Settings {
  readonly model: "ssfm-v30";
  /** @default "auto" */
  readonly language?: ModernLanguage;
  /** @default "normal" */
  readonly emotion?: "normal" | "happy" | "sad" | "angry" | "whisper" | "toneup" | "tonedown";
  /** @minimum 0 @maximum 2 @default 1 */
  readonly emotionIntensity?: number;
  readonly contextBefore?: never;
  readonly contextAfter?: never;
}
interface ModernSmart extends Settings {
  readonly model: "ssfm-v30";
  /** @default "auto" */
  readonly language?: ModernLanguage;
  /** Let native Smart Emotion infer delivery from context. */
  readonly emotion: "auto";
  readonly emotionIntensity?: never;
  readonly contextBefore?: {
    /** @maxLength 2000 */
    readonly text: string;
  };
  readonly contextAfter?: {
    /** @maxLength 2000 */
    readonly text: string;
  };
}
interface Untimed {
  /** Omission uses streaming WAV at 32 kHz. */
  readonly output?: Wave | Mp3;
  readonly volumeScale?: never;
  /** @minimum -70 @maximum 0 */
  readonly targetLoudnessLufs?: number;
  readonly timestampGranularity?: never;
  readonly segments?: never;
}
interface RelativeVolume {
  /** Relative gain, rounded to the nearest native one-percent step. Requires ordinary or timestamped synthesis. @minimum 0 @maximum 2 */
  readonly volumeScale: number;
  readonly targetLoudnessLufs?: never;
}
interface Timed {
  /** One or both timing kinds. Empty arrays disable timing but retain the ordinary endpoint's output format. Japanese/Chinese word alignment may cover whole sentences; prefer character timing. */
  readonly timestampGranularity: Granularity;
  readonly output?: FullWave | Mp3;
  readonly volumeScale?: never;
  /** @minimum -70 @maximum 0 */
  readonly targetLoudnessLufs?: number;
  readonly segments?: never;
}
interface Volume extends RelativeVolume {
  readonly output?: FullWave | Mp3;
  readonly timestampGranularity?: Granularity;
  readonly segments?: never;
}
interface LegacyUntimed extends Legacy, Untimed {}
interface ModernUntimed extends ModernPreset, Untimed {}
interface SmartUntimed extends ModernSmart, Untimed {}
interface LegacyTimed extends Legacy, Timed {}
interface ModernTimed extends ModernPreset, Timed {}
interface SmartTimed extends ModernSmart, Timed {}
interface LegacyVolume extends Legacy, Volume {}
interface ModernVolume extends ModernPreset, Volume {}
interface SmartVolume extends ModernSmart, Volume {}

interface SpeechSegment {
  readonly kind: "speech";
  readonly pauseMs?: never;
  readonly output?: never;
  readonly segments?: never;
  readonly timestampGranularity?: never;
}
interface SegmentRelative {
  /** Rounded to native one-percent steps. @minimum 0 @maximum 2 */
  readonly volumeScale?: number;
  readonly targetLoudnessLufs?: never;
}
interface SegmentAbsolute {
  readonly volumeScale?: never;
  /** @minimum -70 @maximum 0 */
  readonly targetLoudnessLufs: number;
}
interface LegacyRelativeSegment extends Legacy, SpeechSegment, SegmentRelative {}
interface ModernRelativeSegment extends ModernPreset, SpeechSegment, SegmentRelative {}
interface SmartRelativeSegment extends ModernSmart, SpeechSegment, SegmentRelative {}
interface LegacyAbsoluteSegment extends Legacy, SpeechSegment, SegmentAbsolute {}
interface ModernAbsoluteSegment extends ModernPreset, SpeechSegment, SegmentAbsolute {}
interface SmartAbsoluteSegment extends ModernSmart, SpeechSegment, SegmentAbsolute {}
export interface PauseSegment {
  readonly kind: "pause";
  /** @exclusiveMinimum 0 @maximum 10000 */
  readonly pauseMs: number;
  readonly text?: never;
  readonly voice?: never;
  readonly model?: never;
  readonly language?: never;
  readonly emotion?: never;
  readonly emotionIntensity?: never;
  readonly contextBefore?: never;
  readonly contextAfter?: never;
  readonly speed?: never;
  readonly pitchSemitones?: never;
  readonly volumeScale?: never;
  readonly targetLoudnessLufs?: never;
  readonly randomSeed?: never;
}
export type TtsSegment = LegacyRelativeSegment | ModernRelativeSegment | SmartRelativeSegment
  | LegacyAbsoluteSegment | ModernAbsoluteSegment | SmartAbsoluteSegment | PauseSegment;
export interface ComposedRequest {
  /** At least one speech segment, at most 2000 total text code points and 60000 ms total silence. @minItems 1 @maxItems 50 */
  readonly segments: readonly TtsSegment[];
  /** One shared encoding prevents inconsistent formats across speech segments. */
  readonly output?: FullWave | Mp3;
  readonly text?: never;
  readonly voice?: never;
  readonly model?: never;
  readonly language?: never;
  readonly emotion?: never;
  readonly emotionIntensity?: never;
  readonly contextBefore?: never;
  readonly contextAfter?: never;
  readonly speed?: never;
  readonly pitchSemitones?: never;
  readonly volumeScale?: never;
  readonly targetLoudnessLufs?: never;
  readonly randomSeed?: never;
  readonly timestampGranularity?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}

/** Model-aware single-voice or composed synthesis. Every transport accepts whole text, never AsyncIterable input. */
export type TtsRequest = LegacyUntimed | ModernUntimed | SmartUntimed | LegacyTimed | ModernTimed | SmartTimed
  | LegacyVolume | ModernVolume | SmartVolume | ComposedRequest;

/** The timestamp endpoint returns this audio and both independent alignment tracks together in one response. */
export interface TypecastEnvelope {
  readonly correlation: "chunk";
  readonly audio: Uint8Array;
  readonly durationMs: number;
  readonly timestamps: readonly Timestamp<"word" | "character">[];
}
