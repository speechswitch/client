type Output = {
  readonly format: "mp3" | "ogg_opus" | "mulaw";
  /** @minimum 1 */
  readonly sampleRateHz?: number;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  readonly bitRateBps?: never;
};

interface Common {
  readonly text: string;
  readonly language: string;
  readonly output: Output;
  readonly deliveryReference?: string;
  /** @minimum 0 @maximum 1 */
  readonly temperature?: number;
  /** @minimum 0 @maximum 1 */
  readonly deliveryVariance?: number;
  readonly voiceBoost?: boolean;
  readonly durationStretching?: boolean;
  readonly processingPriority?: "standard" | "realtime";
  readonly audioEnhancement?: boolean;
  readonly automaticGainControl?: boolean;
  readonly speakerGender?: "male" | "female";
  readonly accentBlend?: {
    /** @pattern ^.+$ */
    readonly baseLocale: string;
    /** @pattern ^.+$ */
    readonly targetLocale: string;
    /** @minimum 0 @maximum 1 */
    readonly ratio: number;
  };
}
interface Voice {
  /** Existing catalog or custom voice ID; reference audio is not required.
   * @pattern ^.+$
   */
  readonly voice: string;
  readonly referenceAudio?: Uint8Array;
}
interface Reference {
  /** @pattern ^.+$ */
  readonly voice?: string;
  /** Inline reference audio also works without an existing voice ID. */
  readonly referenceAudio: Uint8Array;
}
interface Seeded {
  readonly model: "og-1.1";
  readonly randomSeed: number;
}
interface Unseeded {
  readonly model: "og-1.1" | "lightning-2.5" | "phantom-x-3.2";
  readonly randomSeed?: never;
}
interface Speed {
  /** @minimum 0.5 @maximum 2 */
  readonly speed?: number;
  readonly targetDurationMs?: never;
}
interface Duration {
  readonly speed?: never;
  /** Must be positive. @minimum 0 */
  readonly targetDurationMs: number;
}
interface SeededVoiceSpeed extends Common, Seeded, Voice, Speed {}
interface SeededVoiceDuration extends Common, Seeded, Voice, Duration {}
interface SeededReferenceSpeed extends Common, Seeded, Reference, Speed {}
interface SeededReferenceDuration extends Common, Seeded, Reference, Duration {}
interface UnseededVoiceSpeed extends Common, Unseeded, Voice, Speed {}
interface UnseededVoiceDuration extends Common, Unseeded, Voice, Duration {}
interface UnseededReferenceSpeed extends Common, Unseeded, Reference, Speed {}
interface UnseededReferenceDuration extends Common, Unseeded, Reference, Duration {}

export type TtsRequest = UnseededVoiceSpeed | UnseededVoiceDuration | UnseededReferenceSpeed | UnseededReferenceDuration
  | SeededVoiceSpeed | SeededVoiceDuration | SeededReferenceSpeed | SeededReferenceDuration;
