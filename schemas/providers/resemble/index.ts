interface Output {
  readonly format: "wav";
  readonly sampleRateHz?: never;
  readonly bitRateBps?: never;
  readonly channelCount?: never;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  readonly constantBitRate?: never;
}
interface Chatterbox {
  /** @default "chatterbox" */
  readonly model?: "chatterbox";
  /** @maxLength 300 */
  readonly text: string;
  readonly referenceAudio?: Uint8Array;
  readonly output?: Output;
  /** Zero requests nondeterministic sampling. @default 0 */
  readonly randomSeed?: number;
  /** @minimum 0.05 @maximum 5 @default 0.8 */
  readonly temperature?: number;
  /** CFG strength, also affecting pacing. @minimum 0.2 @maximum 1 @default 0.5 */
  readonly voiceGuidance?: number;
  /** Native style scale, neutral at 0.5. @minimum 0.25 @maximum 2 @default 0.5 */
  readonly styleExaggeration?: number;
  /** @default false */
  readonly referenceAudioTrimming?: boolean;
  readonly speed?: never;
  readonly language?: never;
  readonly minP?: never;
  readonly topP?: never;
  readonly topK?: never;
  readonly repetitionPenalty?: never;
  readonly loudnessNormalization?: never;
  readonly voice?: never;
  readonly inputType?: never;
  readonly timestampGranularity?: never;
  readonly timestampDelivery?: never;
}
interface Multilingual {
  readonly model: "chatterbox-multilingual";
  /** @maxLength 300 */
  readonly text: string;
  readonly referenceAudio?: Uint8Array;
  readonly output?: Output;
  /** @default "en" */
  readonly language?: "en" | "ar" | "da" | "de" | "el" | "es" | "fi" | "fr" | "he" | "hi" | "it" | "ja" | "ko" | "ms" | "nl" | "no" | "pl" | "pt" | "ru" | "sv" | "sw" | "tr" | "zh";
  /** Zero requests nondeterministic sampling. @default 0 */
  readonly randomSeed?: number;
  /** @minimum 0.05 @maximum 5 @default 0.8 */
  readonly temperature?: number;
  /** @minimum 0.2 @maximum 1 @default 0.5 */
  readonly voiceGuidance?: number;
  /** Native style scale, neutral at 0.5. @minimum 0.25 @maximum 2 @default 0.5 */
  readonly styleExaggeration?: number;
  readonly referenceAudioTrimming?: never;
  readonly speed?: never;
  readonly minP?: never;
  readonly topP?: never;
  readonly topK?: never;
  readonly repetitionPenalty?: never;
  readonly loudnessNormalization?: never;
  readonly voice?: never;
  readonly inputType?: never;
  readonly timestampGranularity?: never;
  readonly timestampDelivery?: never;
}
interface Turbo {
  readonly model: "chatterbox-turbo";
  /** Native paralinguistic tags such as [laugh] are passed through unchanged. @maxLength 300 */
  readonly text: string;
  /** Omission selects the deployed Space's current example recording. */
  readonly referenceAudio?: Uint8Array;
  readonly output?: Output;
  /** Zero requests nondeterministic sampling. @default 0 */
  readonly randomSeed?: number;
  /** @minimum 0.05 @maximum 2 @default 0.8 */
  readonly temperature?: number;
  /** @minimum 0 @maximum 1 @default 0 */
  readonly minP?: number;
  /** @minimum 0 @maximum 1 @default 0.95 */
  readonly topP?: number;
  /** Zero disables top-k sampling; the deployment converts this value to an integer. @minimum 0 @maximum 1000 @default 1000 */
  readonly topK?: number;
  /** @minimum 1 @maximum 2 @default 1.2 */
  readonly repetitionPenalty?: number;
  /** Normalize to the deployed -27 LUFS target. @default true */
  readonly loudnessNormalization?: boolean;
  readonly voiceGuidance?: never;
  readonly styleExaggeration?: never;
  readonly referenceAudioTrimming?: never;
  readonly speed?: never;
  readonly language?: never;
  readonly voice?: never;
  readonly inputType?: never;
  readonly timestampGranularity?: never;
  readonly timestampDelivery?: never;
}
/** Deployed Gradio Chatterbox APIs, not Resemble's separate commercial synthesis API. */
export type TtsRequest = Chatterbox | Multilingual | Turbo;
