type Output =
  | { readonly format: "mp3"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "opus"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "mulaw"; readonly sampleRateHz?: number; readonly bitRateBps?: never };

interface Common {
  readonly text: string;
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly referenceAudio?: Uint8Array;
  readonly voiceVariant?: string;
  readonly language: string;
  readonly output: Output;
  /** @minimum 0 @maximum 1 */ readonly temperature?: number;
  /** @minimum 0 @maximum 1 */ readonly deliveryVariance?: number;
  readonly voiceTuning?: { readonly stability?: never; readonly similarity?: never; readonly style?: never; readonly speakerBoost?: boolean };
  readonly durationStretching?: boolean;
  readonly latencyOptimization?: "none" | "aggressive";
  readonly audioEnhancement?: boolean;
  readonly loudnessNormalization?: boolean;
  readonly accentBlend?: {
    readonly baseLocale: string;
    readonly targetLocale: string;
    /** @minimum 0 @maximum 1 */ readonly ratio: number;
  };
  readonly targetGender?: "male" | "female";
  readonly timestampGranularity?: never;
}

interface OriginalSpeed extends Common {
  readonly model: "og-1.1";
  /** @minimum 0.5 @maximum 2 */ readonly speed?: number;
  readonly targetDurationSeconds?: never;
  readonly randomSeed?: number;
}
interface OriginalDuration extends Common {
  readonly model: "og-1.1";
  readonly speed?: never;
  /** @minimum 0 */ readonly targetDurationSeconds: number;
  readonly randomSeed?: number;
}
interface ModernSpeed extends Common {
  readonly model: "lightning-2.5" | "phantom-x-3.2";
  /** @minimum 0.5 @maximum 2 */ readonly speed?: number;
  readonly targetDurationSeconds?: never;
  readonly randomSeed?: never;
}
interface ModernDuration extends Common {
  readonly model: "lightning-2.5" | "phantom-x-3.2";
  readonly speed?: never;
  /** @minimum 0 */ readonly targetDurationSeconds: number;
  readonly randomSeed?: never;
}

export type TtsRequest = OriginalSpeed | OriginalDuration | ModernSpeed | ModernDuration;
