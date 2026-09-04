type Output = { readonly format: "wav"; readonly sampleRateHz?: never; readonly bitRateBps?: never };

interface Common {
  /** @maxLength 300 */
  readonly text: string;
  readonly referenceAudio?: Uint8Array;
  readonly output: Output;
  readonly randomSeed?: number;
}

interface Chatterbox extends Common {
  readonly model: "chatterbox";
  readonly language?: never;
  /** @minimum 0.05 @maximum 5 */
  readonly temperature?: number;
  /** @minimum 0.2 @maximum 1 */
  readonly guidanceScale?: number;
  readonly voiceTuning?: {
    readonly stability?: never;
    readonly similarity?: never;
    /** @minimum 0.25 @maximum 2 */
    readonly style?: number;
    readonly speakerBoost?: never;
  };
  readonly referenceAudioTrimming?: boolean;
  readonly minimumTokenProbability?: never;
  readonly topProbabilityMass?: never;
  readonly topTokenCount?: never;
  readonly repetitionPenalty?: never;
  readonly loudnessNormalization?: never;
}

interface ChatterboxMultilingual extends Common {
  readonly model: "chatterbox-multilingual";
  readonly language: "en" | "ar" | "da" | "de" | "el" | "es" | "fi" | "fr" | "he" | "hi" | "it" | "ja" | "ko" | "ms" | "nl" | "no" | "pl" | "pt" | "ru" | "sv" | "sw" | "tr" | "zh";
  /** @minimum 0.05 @maximum 5 */
  readonly temperature?: number;
  /** @minimum 0.2 @maximum 1 */
  readonly guidanceScale?: number;
  readonly voiceTuning?: {
    readonly stability?: never;
    readonly similarity?: never;
    /** @minimum 0.25 @maximum 2 */
    readonly style?: number;
    readonly speakerBoost?: never;
  };
  readonly referenceAudioTrimming?: never;
  readonly minimumTokenProbability?: never;
  readonly topProbabilityMass?: never;
  readonly topTokenCount?: never;
  readonly repetitionPenalty?: never;
  readonly loudnessNormalization?: never;
}

interface ChatterboxTurbo extends Common {
  readonly model: "chatterbox-turbo";
  readonly language?: never;
  /** @minimum 0.05 @maximum 2 */
  readonly temperature?: number;
  readonly guidanceScale?: never;
  readonly voiceTuning?: never;
  readonly referenceAudioTrimming?: never;
  /** @minimum 0 @maximum 1 */
  readonly minimumTokenProbability?: number;
  /** @minimum 0 @maximum 1 */
  readonly topProbabilityMass?: number;
  /** @minimum 0 @maximum 1000 */
  readonly topTokenCount?: number;
  /** @minimum 1 @maximum 2 */
  readonly repetitionPenalty?: number;
  readonly loudnessNormalization?: boolean;
}

export type TtsRequest = Chatterbox | ChatterboxMultilingual | ChatterboxTurbo;
