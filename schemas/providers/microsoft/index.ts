interface Encoded {
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface Mp3At16Khz extends Encoded {
  readonly format: "mp3";
  readonly sampleRateHz: 16000;
  readonly bitRateBps: 32000 | 64000 | 128000;
}
interface Mp3At24Khz extends Encoded {
  readonly format: "mp3";
  readonly sampleRateHz: 24000;
  readonly bitRateBps: 48000 | 96000 | 160000;
}
interface Mp3At48Khz extends Encoded {
  readonly format: "mp3";
  readonly sampleRateHz: 48000;
  readonly bitRateBps: 96000 | 192000;
}
interface Pcm {
  readonly format: "pcm";
  readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
  readonly sampleEncoding?: "signed_integer_16";
  readonly byteOrder?: "little_endian";
  readonly bitRateBps?: never;
}
interface OggOpus extends Encoded {
  readonly format: "ogg_opus";
  readonly sampleRateHz: 16000 | 24000 | 48000;
  readonly bitRateBps?: never;
}
interface RawOpusAt16Khz extends Encoded {
  readonly format: "opus";
  readonly sampleRateHz: 16000;
  readonly bitRateBps: 32000;
}
interface RawOpusAt24Khz extends Encoded {
  readonly format: "opus";
  readonly sampleRateHz: 24000;
  readonly bitRateBps: 24000 | 48000;
}
interface WebmOpusAt16Khz extends Encoded {
  readonly format: "webm_opus";
  readonly sampleRateHz: 16000;
  readonly bitRateBps?: never;
}
interface WebmOpusAt24Khz extends Encoded {
  readonly format: "webm_opus";
  readonly sampleRateHz: 24000;
  /** Omission uses the provider's default bitrate variant. */
  readonly bitRateBps?: 24000;
}
interface Telephony extends Encoded {
  readonly format: "alaw" | "mulaw";
  readonly sampleRateHz: 8000;
  readonly bitRateBps?: never;
}
interface TrueSilk extends Encoded {
  readonly format: "truesilk";
  readonly sampleRateHz: 16000 | 24000;
  readonly bitRateBps?: never;
}
interface Amr extends Encoded {
  readonly format: "amr_wb";
  readonly sampleRateHz: 16000;
  readonly bitRateBps?: never;
}
interface G722 extends Encoded {
  readonly format: "g722";
  readonly sampleRateHz: 16000;
  readonly bitRateBps: 64000;
}
interface WavPcm {
  readonly format: "wav";
  readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
  readonly sampleEncoding?: "signed_integer_16";
  readonly byteOrder?: "little_endian";
  readonly bitRateBps?: never;
}
interface WavTelephony {
  readonly format: "wav";
  readonly sampleRateHz: 8000;
  readonly sampleEncoding: "alaw" | "mulaw";
  readonly byteOrder?: never;
  readonly bitRateBps?: never;
}
export type StreamingOutput = Mp3At16Khz | Mp3At24Khz | Mp3At48Khz | Pcm | OggOpus | RawOpusAt16Khz | RawOpusAt24Khz | WebmOpusAt16Khz | WebmOpusAt24Khz | Telephony | TrueSilk | Amr | G722;
export type Output = StreamingOutput | WavPcm | WavTelephony;

interface TextSettings {
  /** Full neural/custom voice name, or the persona before the colon for an HD/MAI model (for example en-US-Ava). The model adds its own suffix.
   * @pattern ^[^:\r\n]+$
   */
  readonly voice: string;
  /** Locale override. Multilingual voices can detect languages within text when omitted; HD SSML applies an explicit override with a lang element. */
  readonly language?: string;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}
interface StaticInput {
  readonly text: string;
  readonly inputType?: "text";
  /** Omission selects raw signed 16-bit little-endian PCM at 24 kHz. WAV uses the non-streaming-input REST endpoint. */
  readonly output?: Output;
}
interface StreamingInput {
  /** Native WebSocket v2 incremental text; not client-side sentence batching. Cancellation is through AbortSignal. */
  readonly text: AsyncIterable<string>;
  readonly inputType?: "text";
  /** Omission selects raw signed 16-bit little-endian PCM at 24 kHz. WAV needs a complete-file header and is not available in this input mode. */
  readonly output?: StreamingOutput;
}
interface NeuralSettings extends TextSettings {
  /** @default "neural" */
  readonly model?: "neural";
  /** Prosody support also depends on the selected voice. @minimum 0.5 @maximum 2 */
  readonly speed?: number;
  /** Native pitch range is 0.5–1.5 times the original frequency. @minimum -12 @maximum 7.019550008653875 */
  readonly pitchSemitones?: number;
  /** Native volume level divided by 100, not decibels. @minimum 0 @maximum 1 */
  readonly volumeScale?: number;
  readonly volumeDb?: never;
  /** Voice-specific SSML speaking style. */
  readonly emotion?: string;
  readonly temperature?: never;
  readonly topP?: never;
  readonly topK?: never;
  readonly voiceGuidance?: never;
  readonly namedEntityPronunciationEnhancement?: never;
}
interface HdSettings extends TextSettings {
  /** Uses DragonHDLatestNeural. */
  readonly model: "dragon-hd";
  /** @minimum 0 @maximum 1 @default 1 */
  readonly temperature?: number;
  readonly speed?: never;
  readonly pitchSemitones?: never;
  readonly volumeDb?: never;
  readonly volumeScale?: never;
  /** DragonHD's express-as support is contradictory in the current docs; raw SSML remains available. */
  readonly emotion?: never;
  readonly topP?: never;
  readonly topK?: never;
  readonly voiceGuidance?: never;
  readonly timestampGranularity?: never;
}
interface OmniSettings extends TextSettings {
  /** Uses DragonHDOmniLatestNeural. */
  readonly model: "dragon-hd-omni";
  /** @minimum 0.3 @maximum 1 @default 0.7 */
  readonly temperature?: number;
  readonly emotion?: string;
  readonly speed?: never;
  readonly pitchSemitones?: never;
  readonly volumeDb?: never;
  readonly volumeScale?: never;
  readonly namedEntityPronunciationEnhancement?: never;
}
interface MaiSettings extends TextSettings {
  /** Current MAI models in the upstream catalog; MAI-Voice-1 is no longer documented there. */
  readonly model: "mai-voice-2" | "mai-voice-2-flash";
  readonly emotion?: string;
  readonly speed?: never;
  readonly pitchSemitones?: never;
  readonly volumeDb?: never;
  readonly volumeScale?: never;
  readonly temperature?: never;
  readonly topP?: never;
  readonly topK?: never;
  readonly voiceGuidance?: never;
  readonly namedEntityPronunciationEnhancement?: never;
  readonly timestampGranularity?: never;
}
interface FlashSettings extends TextSettings {
  /** Uses DragonHDFlashLatestNeural; its current language support is narrower than DragonHD/Omni. */
  readonly model: "dragon-hd-flash";
  readonly language?: "en-US" | "zh-CN";
  readonly emotion?: string;
  readonly speed?: never;
  readonly pitchSemitones?: never;
  readonly volumeDb?: never;
  readonly volumeScale?: never;
  readonly temperature?: never;
  readonly topP?: never;
  readonly topK?: never;
  readonly voiceGuidance?: never;
  readonly namedEntityPronunciationEnhancement?: never;
  readonly timestampGranularity?: never;
}

export interface NeuralRequest extends NeuralSettings, StaticInput {
  /** REST WAV does not carry timing metadata. */
  readonly timestampGranularity?: never;
}
export interface NeuralStreamingRequest extends NeuralSettings, StreamingInput {
  readonly timestampGranularity?: "word" | "sentence" | readonly ("word" | "sentence")[];
}
export interface HdRequest extends HdSettings, StaticInput {
  readonly namedEntityPronunciationEnhancement?: boolean;
}
export interface HdStreamingRequest extends HdSettings, StreamingInput {
  readonly namedEntityPronunciationEnhancement?: never;
}
export interface OmniRequest extends OmniSettings, StaticInput {
  /** @minimum 0.3 @maximum 1 @default 0.7 */
  readonly topP?: number;
  /** Integer candidate count. @minimum 1 @maximum 50 @default 22 @integer */
  readonly topK?: number;
  /** Classifier-free guidance scale. @minimum 1 @maximum 2 @default 1.4 */
  readonly voiceGuidance?: number;
  readonly timestampGranularity?: never;
}
export interface OmniStreamingRequest extends OmniSettings, StreamingInput {
  readonly topP?: never;
  readonly topK?: never;
  readonly voiceGuidance?: never;
  readonly timestampGranularity?: "word";
}
export interface MaiRequest extends MaiSettings, StaticInput {}
export interface MaiStreamingRequest extends MaiSettings, StreamingInput {}
export interface FlashRequest extends FlashSettings, StaticInput {}
export interface FlashStreamingRequest extends FlashSettings, StreamingInput {}

interface TimedInput {
  readonly text: string;
  readonly inputType?: "text";
  readonly output?: StreamingOutput;
}
/** Whole-text synthesis also supports native timestamp events without pretending its input is incremental. */
export interface NeuralTimedRequest extends NeuralSettings, TimedInput {
  readonly timestampGranularity: "word" | "sentence" | readonly ("word" | "sentence")[];
}
export interface OmniTimedRequest extends OmniSettings, TimedInput {
  readonly timestampGranularity: "word";
  /** @minimum 0.3 @maximum 1 @default 0.7 */
  readonly topP?: number;
  /** @minimum 1 @maximum 50 @default 22 @integer */
  readonly topK?: number;
  /** @minimum 1 @maximum 2 @default 1.4 */
  readonly voiceGuidance?: number;
}

interface SsmlSettings {
  /** Complete SSML document; voice, model and delivery are authored inside it. The selected voice still determines supported SSML elements. */
  readonly inputType: "ssml";
  readonly text: string;
  readonly model?: never;
  readonly voice?: never;
  readonly language?: never;
  readonly speed?: never;
  readonly pitchSemitones?: never;
  readonly volumeDb?: never;
  readonly volumeScale?: never;
  readonly emotion?: never;
  readonly temperature?: never;
  readonly topP?: never;
  readonly topK?: never;
  readonly voiceGuidance?: never;
  readonly namedEntityPronunciationEnhancement?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}
export interface SsmlRequest extends SsmlSettings {
  readonly output?: Output;
  readonly timestampGranularity?: never;
}
export interface SsmlTimedRequest extends SsmlSettings {
  readonly output?: StreamingOutput;
  readonly timestampGranularity: "word" | "sentence" | "viseme" | "ssml" | readonly ("word" | "sentence" | "viseme" | "ssml")[];
}

/** Model and input variants keep unsupported combinations out of all generated language APIs. */
export type TtsRequest = NeuralRequest | NeuralStreamingRequest | NeuralTimedRequest
  | HdRequest | HdStreamingRequest | OmniRequest | OmniStreamingRequest | OmniTimedRequest
  | MaiRequest | MaiStreamingRequest | FlashRequest | FlashStreamingRequest | SsmlRequest | SsmlTimedRequest;
