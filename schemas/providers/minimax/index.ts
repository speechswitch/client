type LegacyLanguage = "zh" | "yue" | "en" | "ar" | "ru" | "es" | "fr" | "pt" | "de" | "tr" | "nl" | "uk" | "vi" | "id" | "ja" | "it" | "ko" | "th" | "pl" | "ro" | "el" | "cs" | "fi" | "hi" | "bg" | "da" | "he" | "ms" | "sk" | "sv" | "hr" | "hu" | "no" | "sl" | "ca" | "nn" | "af" | "auto";
type Language = "zh" | "yue" | "en" | "ar" | "ru" | "es" | "fr" | "pt" | "de" | "tr" | "nl" | "uk" | "vi" | "id" | "ja" | "it" | "ko" | "th" | "pl" | "ro" | "el" | "cs" | "fi" | "hi" | "bg" | "da" | "he" | "ms" | "sk" | "sv" | "hr" | "hu" | "no" | "sl" | "ca" | "nn" | "af" | "auto" | "fa" | "fil" | "ta";
type Emotion = "happy" | "sad" | "angry" | "fearful" | "disgusted" | "surprised" | "calm";

interface Audio {
  /** @default 1 */
  readonly channelCount?: 1 | 2;
  readonly byteOrder?: never;
}
interface Mp3 extends Audio {
  readonly format: "mp3";
  /** @default 32000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
  /** @default 128000 */
  readonly bitRateBps?: 32000 | 64000 | 128000 | 256000;
  /** HTTP streaming MP3 only. @default false */
  readonly constantBitRate?: boolean;
  readonly sampleEncoding?: never;
}
interface SocketMp3 extends Audio {
  readonly format: "mp3";
  /** @default 32000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
  /** @default 128000 */
  readonly bitRateBps?: 32000 | 64000 | 128000 | 256000;
  readonly constantBitRate?: never;
  readonly sampleEncoding?: never;
}
interface Lossless extends Audio {
  readonly format: "pcm" | "flac";
  /** The contract does not specify raw PCM sample representation. @default 32000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
  readonly sampleEncoding?: never;
}
interface Flac extends Audio {
  readonly format: "flac";
  /** @default 32000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
  readonly sampleEncoding?: never;
}
interface Wav extends Audio {
  readonly format: "wav";
  /** Non-streaming HTTP output; sample representation is described by the returned container. @default 32000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
  readonly sampleEncoding?: never;
}
interface Mulaw extends Audio {
  readonly format: "mulaw";
  /** @default 8000 */
  readonly sampleRateHz?: 8000;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
  readonly sampleEncoding?: never;
}
interface MulawWav extends Audio {
  readonly format: "wav";
  /** Unlike ordinary WAV, pcmu_wav supports streaming. */
  readonly sampleEncoding: "mulaw";
  /** @default 8000 */
  readonly sampleRateHz?: 8000;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
}
interface Opus extends Audio {
  readonly format: "ogg_opus";
  /** Default selected by the first-party CLI; native token is opus (Ogg container). @default 24000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
  readonly bitRateBps?: never;
  readonly constantBitRate?: never;
  readonly sampleEncoding?: never;
}
export type HttpOutput = Mp3 | Lossless | Wav | Mulaw | MulawWav | Opus;
export type StreamingOutput = SocketMp3 | Lossless | Mulaw | MulawWav | Opus;

export interface VoiceTransform {
  /** Deep (-100) to bright (100); this is not a semitone shift. @minimum -100 @maximum 100 @integer */
  readonly brightness?: number;
  /** Forceful (-100) to soft (100). @minimum -100 @maximum 100 @integer */
  readonly softness?: number;
  /** Full/rich (-100) to crisp (100). @minimum -100 @maximum 100 @integer */
  readonly crispness?: number;
  readonly effect?: "spacious_echo" | "auditorium_echo" | "telephone" | "robotic";
}
interface SingleVoice {
  /** Existing system, cloned, or generated voice ID. @pattern ^(?=[\s\S]*\S)[\s\S]+$ */
  readonly voice: string;
  readonly voiceBlend?: never;
}
interface BlendedVoice {
  readonly voice?: never;
  /** One to four existing voices; integer relative weights, not necessarily totaling 100. @minItems 1 @maxItems 4 */
  readonly voiceBlend: readonly {
    /** @pattern ^(?=[\s\S]*\S)[\s\S]+$ */
    readonly voice: string;
    /** @minimum 1 @maximum 100 @integer */
    readonly weight: number;
  }[];
}
interface Settings {
  /** @minimum 0.5 @maximum 2 @default 1 */
  readonly speed?: number;
  /** @exclusiveMinimum 0 @maximum 10 @default 1 */
  readonly volumeScale?: number;
  /** Native pitch adjustment; upstream does not document semitone units. @minimum -12 @maximum 12 @default 0 @integer */
  readonly pitchBias?: number;
  readonly pitchSemitones?: never;
  readonly replacements?: readonly {
    /** Slash is the native rule separator and cannot be escaped. @pattern ^[^/]+$ */
    readonly pattern: string;
    /** May contain inline IPA/Pinyin/Jyutping annotations or Japanese kana. @pattern ^[^/]+$ */
    readonly replacement: string;
    readonly alphabet?: never;
  }[];
  readonly inputType?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}
interface LegacyModel {
  readonly model: "speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo";
  readonly emotion?: Emotion;
  readonly splitTurns?: never;
}
interface V26Model {
  readonly model: "speech-2.6-hd" | "speech-2.6-turbo";
  readonly emotion?: Emotion | "fluent" | "whisper";
  readonly splitTurns?: never;
}
interface V28Model {
  /** @default "speech-2.8-hd" */
  readonly model?: "speech-2.8-hd" | "speech-2.8-turbo";
  /** Current docs reserve fluent/whisper for 2.6; inline interjections pass through the text. */
  readonly emotion?: Emotion;
}
interface LegacyText {
  /** @default "auto" */
  readonly language?: LegacyLanguage;
  readonly formulaReading?: never;
}
interface ModernText {
  /** @default "auto" */
  readonly language?: Language;
  readonly formulaReading?: never;
}
interface FormulaText {
  /** Enables native Chinese-only LaTeX reading; formulas must be wrapped in double dollars. */
  readonly formulaReading: "latex";
  /** @default "zh" */
  readonly language?: "zh";
}
interface HttpInput {
  /** Whole-text native HTTP synthesis; pause and pronunciation markers pass through. @pattern ^[\s\S]{1,9999}$ */
  readonly text: string;
  /** Normalize Chinese/English text with the HTTP text_normalization field. @default false */
  readonly textNormalization?: boolean;
  readonly languageTextNormalization?: never;
  readonly splitTurns?: never;
  /** Fetched from the documented subtitle_file response on an independent request timeline. */
  readonly timestampGranularity?: "word" | "sentence";
  readonly timestampDelivery?: "trailing";
}
export type TtsInput = string | { readonly command: "clear" } | { readonly command: "flush" };
interface SocketInput {
  /** Native bidirectional input; each text item must contain fewer than 10,000 characters. */
  readonly text: AsyncIterable<TtsInput>;
  /** English-only native english_normalization; not HTTP's general normalization flag. @default false */
  readonly languageTextNormalization?: boolean;
  readonly textNormalization?: never;
  /** Request schemas mention subtitles, but no first-party WebSocket subtitle response shape is published. */
  readonly timestampGranularity?: never;
  readonly timestampDelivery?: never;
}
interface SocketV28Input extends SocketInput {
  /** Inverse of native continuous_sound. Only 2.8 supports model-side concurrent segmentation. @default true */
  readonly splitTurns?: boolean;
}
interface HttpAudio {
  /** Omission selects MP3 at 32 kHz, 128 kbps, mono. */
  readonly output?: HttpOutput;
  readonly voiceTransform?: never;
}
interface HttpEffects {
  /** FLAC/WAV with voice effects require native non-streaming output; the SDK still returns an audio iterator. */
  readonly output?: Mp3 | Wav | Flac;
  readonly voiceTransform: VoiceTransform;
}
interface SocketAudio {
  readonly output?: StreamingOutput;
  readonly voiceTransform?: never;
}
interface SocketEffects {
  readonly output?: SocketMp3;
  readonly voiceTransform: VoiceTransform;
}

export interface LegacyHttpSingleRequest extends Settings, LegacyModel, HttpInput, SingleVoice, LegacyText, HttpAudio {}
export interface LegacyHttpSingleEffectsRequest extends Settings, LegacyModel, HttpInput, SingleVoice, LegacyText, HttpEffects {}
export interface LegacyHttpSingleFormulaRequest extends Settings, LegacyModel, HttpInput, SingleVoice, FormulaText, HttpAudio {}
export interface LegacyHttpSingleFormulaEffectsRequest extends Settings, LegacyModel, HttpInput, SingleVoice, FormulaText, HttpEffects {}
export interface LegacyHttpBlendedRequest extends Settings, LegacyModel, HttpInput, BlendedVoice, LegacyText, HttpAudio {}
export interface LegacyHttpBlendedEffectsRequest extends Settings, LegacyModel, HttpInput, BlendedVoice, LegacyText, HttpEffects {}
export interface LegacyHttpBlendedFormulaRequest extends Settings, LegacyModel, HttpInput, BlendedVoice, FormulaText, HttpAudio {}
export interface LegacyHttpBlendedFormulaEffectsRequest extends Settings, LegacyModel, HttpInput, BlendedVoice, FormulaText, HttpEffects {}
export interface LegacySocketSingleRequest extends Settings, LegacyModel, SocketInput, SingleVoice, LegacyText, SocketAudio {}
export interface LegacySocketSingleEffectsRequest extends Settings, LegacyModel, SocketInput, SingleVoice, LegacyText, SocketEffects {}
export interface LegacySocketSingleFormulaRequest extends Settings, LegacyModel, SocketInput, SingleVoice, FormulaText, SocketAudio {}
export interface LegacySocketSingleFormulaEffectsRequest extends Settings, LegacyModel, SocketInput, SingleVoice, FormulaText, SocketEffects {}
export interface LegacySocketBlendedRequest extends Settings, LegacyModel, SocketInput, BlendedVoice, LegacyText, SocketAudio {}
export interface LegacySocketBlendedEffectsRequest extends Settings, LegacyModel, SocketInput, BlendedVoice, LegacyText, SocketEffects {}
export interface LegacySocketBlendedFormulaRequest extends Settings, LegacyModel, SocketInput, BlendedVoice, FormulaText, SocketAudio {}
export interface LegacySocketBlendedFormulaEffectsRequest extends Settings, LegacyModel, SocketInput, BlendedVoice, FormulaText, SocketEffects {}
export interface V26HttpSingleRequest extends Settings, V26Model, HttpInput, SingleVoice, ModernText, HttpAudio {}
export interface V26HttpSingleEffectsRequest extends Settings, V26Model, HttpInput, SingleVoice, ModernText, HttpEffects {}
export interface V26HttpSingleFormulaRequest extends Settings, V26Model, HttpInput, SingleVoice, FormulaText, HttpAudio {}
export interface V26HttpSingleFormulaEffectsRequest extends Settings, V26Model, HttpInput, SingleVoice, FormulaText, HttpEffects {}
export interface V26HttpBlendedRequest extends Settings, V26Model, HttpInput, BlendedVoice, ModernText, HttpAudio {}
export interface V26HttpBlendedEffectsRequest extends Settings, V26Model, HttpInput, BlendedVoice, ModernText, HttpEffects {}
export interface V26HttpBlendedFormulaRequest extends Settings, V26Model, HttpInput, BlendedVoice, FormulaText, HttpAudio {}
export interface V26HttpBlendedFormulaEffectsRequest extends Settings, V26Model, HttpInput, BlendedVoice, FormulaText, HttpEffects {}
export interface V26SocketSingleRequest extends Settings, V26Model, SocketInput, SingleVoice, ModernText, SocketAudio {}
export interface V26SocketSingleEffectsRequest extends Settings, V26Model, SocketInput, SingleVoice, ModernText, SocketEffects {}
export interface V26SocketSingleFormulaRequest extends Settings, V26Model, SocketInput, SingleVoice, FormulaText, SocketAudio {}
export interface V26SocketSingleFormulaEffectsRequest extends Settings, V26Model, SocketInput, SingleVoice, FormulaText, SocketEffects {}
export interface V26SocketBlendedRequest extends Settings, V26Model, SocketInput, BlendedVoice, ModernText, SocketAudio {}
export interface V26SocketBlendedEffectsRequest extends Settings, V26Model, SocketInput, BlendedVoice, ModernText, SocketEffects {}
export interface V26SocketBlendedFormulaRequest extends Settings, V26Model, SocketInput, BlendedVoice, FormulaText, SocketAudio {}
export interface V26SocketBlendedFormulaEffectsRequest extends Settings, V26Model, SocketInput, BlendedVoice, FormulaText, SocketEffects {}
export interface V28HttpSingleRequest extends Settings, V28Model, HttpInput, SingleVoice, ModernText, HttpAudio {}
export interface V28HttpSingleEffectsRequest extends Settings, V28Model, HttpInput, SingleVoice, ModernText, HttpEffects {}
export interface V28HttpSingleFormulaRequest extends Settings, V28Model, HttpInput, SingleVoice, FormulaText, HttpAudio {}
export interface V28HttpSingleFormulaEffectsRequest extends Settings, V28Model, HttpInput, SingleVoice, FormulaText, HttpEffects {}
export interface V28HttpBlendedRequest extends Settings, V28Model, HttpInput, BlendedVoice, ModernText, HttpAudio {}
export interface V28HttpBlendedEffectsRequest extends Settings, V28Model, HttpInput, BlendedVoice, ModernText, HttpEffects {}
export interface V28HttpBlendedFormulaRequest extends Settings, V28Model, HttpInput, BlendedVoice, FormulaText, HttpAudio {}
export interface V28HttpBlendedFormulaEffectsRequest extends Settings, V28Model, HttpInput, BlendedVoice, FormulaText, HttpEffects {}
export interface V28SocketSingleRequest extends Settings, V28Model, SocketV28Input, SingleVoice, ModernText, SocketAudio {}
export interface V28SocketSingleEffectsRequest extends Settings, V28Model, SocketV28Input, SingleVoice, ModernText, SocketEffects {}
export interface V28SocketSingleFormulaRequest extends Settings, V28Model, SocketV28Input, SingleVoice, FormulaText, SocketAudio {}
export interface V28SocketSingleFormulaEffectsRequest extends Settings, V28Model, SocketV28Input, SingleVoice, FormulaText, SocketEffects {}
export interface V28SocketBlendedRequest extends Settings, V28Model, SocketV28Input, BlendedVoice, ModernText, SocketAudio {}
export interface V28SocketBlendedEffectsRequest extends Settings, V28Model, SocketV28Input, BlendedVoice, ModernText, SocketEffects {}
export interface V28SocketBlendedFormulaRequest extends Settings, V28Model, SocketV28Input, BlendedVoice, FormulaText, SocketAudio {}
export interface V28SocketBlendedFormulaEffectsRequest extends Settings, V28Model, SocketV28Input, BlendedVoice, FormulaText, SocketEffects {}

/** Provider/model/transport combinations stay here; the shared base stays sum-type free. */
export type TtsRequest =
    LegacyHttpSingleRequest
  | LegacyHttpSingleEffectsRequest
  | LegacyHttpSingleFormulaRequest
  | LegacyHttpSingleFormulaEffectsRequest
  | LegacyHttpBlendedRequest
  | LegacyHttpBlendedEffectsRequest
  | LegacyHttpBlendedFormulaRequest
  | LegacyHttpBlendedFormulaEffectsRequest
  | LegacySocketSingleRequest
  | LegacySocketSingleEffectsRequest
  | LegacySocketSingleFormulaRequest
  | LegacySocketSingleFormulaEffectsRequest
  | LegacySocketBlendedRequest
  | LegacySocketBlendedEffectsRequest
  | LegacySocketBlendedFormulaRequest
  | LegacySocketBlendedFormulaEffectsRequest
  | V26HttpSingleRequest
  | V26HttpSingleEffectsRequest
  | V26HttpSingleFormulaRequest
  | V26HttpSingleFormulaEffectsRequest
  | V26HttpBlendedRequest
  | V26HttpBlendedEffectsRequest
  | V26HttpBlendedFormulaRequest
  | V26HttpBlendedFormulaEffectsRequest
  | V26SocketSingleRequest
  | V26SocketSingleEffectsRequest
  | V26SocketSingleFormulaRequest
  | V26SocketSingleFormulaEffectsRequest
  | V26SocketBlendedRequest
  | V26SocketBlendedEffectsRequest
  | V26SocketBlendedFormulaRequest
  | V26SocketBlendedFormulaEffectsRequest
  | V28HttpSingleRequest
  | V28HttpSingleEffectsRequest
  | V28HttpSingleFormulaRequest
  | V28HttpSingleFormulaEffectsRequest
  | V28HttpBlendedRequest
  | V28HttpBlendedEffectsRequest
  | V28HttpBlendedFormulaRequest
  | V28HttpBlendedFormulaEffectsRequest
  | V28SocketSingleRequest
  | V28SocketSingleEffectsRequest
  | V28SocketSingleFormulaRequest
  | V28SocketSingleFormulaEffectsRequest
  | V28SocketBlendedRequest
  | V28SocketBlendedEffectsRequest
  | V28SocketBlendedFormulaRequest
  | V28SocketBlendedFormulaEffectsRequest;
