/** LOVO Genny's job-based TTS API. The selected voice determines model and language. */
export interface TtsRequest {
  /** Whole text only, limited to 500 Unicode code points. The pattern counts surrogate pairs once; no streaming input or native cancel command exists.
   * @pattern ^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDBFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])){1,500}$
   */
  readonly text: string;
  /** Existing speaker ID from the provider's voice catalog. @pattern ^[\s\S]+$ */
  readonly voice: string;
  /** A saved style ID belonging to the selected voice; only some voices have multiple styles. */
  readonly voiceStyle?: string;
  /** @minimum 0.05 @maximum 3 @default 1 */
  readonly speed?: number;
  readonly model?: never;
  readonly language?: never;
  readonly output?: never;
  readonly timestampGranularity?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}

export interface LovoAudioEnvelope {
  readonly correlation: "ordered";
  /** Job/output/asset identity. A new ID starts a separate audio file, not a continuation of the previous container. */
  readonly correlationId: string;
  readonly inputGroupId: string;
  readonly audio: Uint8Array;
  readonly timestamps: readonly [];
}
export type SynthesisItem = LovoAudioEnvelope;
