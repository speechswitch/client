type Language = "en" | "fr" | "de" | "es" | "pt" | "zh" | "ja" | "hi" | "it" | "ko" | "nl" | "pl" | "ru" | "sv" | "tr" | "tl" | "bg" | "ro" | "ar" | "cs" | "el" | "fi" | "hr" | "ms" | "sk" | "da" | "ta" | "uk" | "hu" | "no" | "vi" | "bn" | "th" | "he" | "ka" | "id" | "te" | "gu" | "kn" | "ml" | "mr" | "pa" | "or" | "ur";
type Emotion = "neutral" | "happy" | "excited" | "enthusiastic" | "elated" | "euphoric" | "triumphant" | "amazed" | "surprised" | "flirtatious" | "curious" | "content" | "peaceful" | "serene" | "calm" | "grateful" | "affectionate" | "trust" | "sympathetic" | "anticipation" | "mysterious" | "angry" | "mad" | "outraged" | "frustrated" | "agitated" | "threatened" | "disgusted" | "contempt" | "envious" | "sarcastic" | "ironic" | "sad" | "dejected" | "melancholic" | "disappointed" | "hurt" | "guilty" | "bored" | "tired" | "rejected" | "nostalgic" | "wistful" | "apologetic" | "hesitant" | "insecure" | "confused" | "resigned" | "anxious" | "panicked" | "alarmed" | "scared" | "proud" | "confident" | "distant" | "skeptical" | "contemplative" | "determined";
type SampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
type RawOutput =
  | { readonly format: "pcm"; readonly sampleRateHz: SampleRate; readonly sampleEncoding: "signed_integer_16" | "float_32"; readonly byteOrder: "little_endian"; readonly bitRateBps?: never }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz: SampleRate; readonly bitRateBps?: never };
type Output = RawOutput
  | { readonly format: "mp3"; readonly sampleRateHz: SampleRate; readonly bitRateBps: 32000 | 64000 | 96000 | 128000 | 192000 }
  | { readonly format: "wav"; readonly sampleRateHz: SampleRate; readonly sampleEncoding?: "signed_integer_16" | "float_32" | "mulaw" | "alaw"; readonly byteOrder?: "little_endian"; readonly bitRateBps?: never };

interface Common {
  /** Existing catalog or custom voice ID; no reference recording is required. */
  readonly voice: string;
  readonly accent?: string;
  /** @minimum 0.6 @maximum 1.5 */
  readonly speed?: number;
  /** @minimum 0.5 @maximum 2 */
  readonly volumeScale?: number;
  readonly textNormalization?: boolean | { readonly locale: string };
  /** One pronunciation dictionary ID. */
  readonly lexicon?: string;
}
interface OlderModel {
  readonly model: "sonic-3" | "sonic-3.5";
  readonly language?: Language;
}
interface RegionalModel {
  readonly model: "sonic-3.6";
  /** Base language or regional locale; sent through Cartesia's locale field. */
  readonly language?: string;
}
interface Bytes {
  readonly text: string;
  readonly output: Output;
  readonly emotion?: Emotion;
  readonly timestampGranularity?: never;
  readonly timestampText?: never;
  readonly maxBufferDelayMs?: never;
}
interface TimedText {
  readonly text: string;
  readonly output: RawOutput;
  readonly emotion?: Emotion;
  readonly timestampGranularity: "word" | "phoneme" | readonly ("word" | "phoneme")[];
  readonly timestampText?: "original" | "normalized";
  readonly maxBufferDelayMs?: never;
}
interface Live {
  readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>;
  readonly output: RawOutput;
  readonly emotion?: Emotion;
  /** @minimum 0 @maximum 5000 */
  readonly maxBufferDelayMs?: number;
}
interface Untimed {
  readonly timestampGranularity?: never;
  readonly timestampText?: never;
}
interface Timed {
  readonly timestampGranularity: "word" | "phoneme" | readonly ("word" | "phoneme")[];
  readonly timestampText?: "original" | "normalized";
}
interface OlderBytes extends Common, OlderModel, Bytes {}
interface RegionalBytes extends Common, RegionalModel, Bytes {}
interface OlderTimedText extends Common, OlderModel, TimedText {}
interface RegionalTimedText extends Common, RegionalModel, TimedText {}
interface OlderLive extends Common, OlderModel, Live, Untimed {}
interface RegionalLive extends Common, RegionalModel, Live, Untimed {}
interface OlderTimedLive extends Common, OlderModel, Live, Timed {}
interface RegionalTimedLive extends Common, RegionalModel, Live, Timed {}

export type TtsRequest = OlderBytes | RegionalBytes | OlderTimedText | RegionalTimedText | OlderLive | RegionalLive | OlderTimedLive | RegionalTimedLive;
