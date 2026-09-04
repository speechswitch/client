type Language = "auto" | "zh" | "en-us" | "ja" | "ko" | "fr-fr" | "pt" | "de" | "es" | "yue";
type Output = { readonly format: "mp3"; readonly sampleRateHz?: never; readonly bitRateBps?: never };
interface Controls {
  readonly model: "v3.5";
  readonly language?: Language;
  readonly voiceVariant?: string;
  readonly deliveryVariation?: "stable" | "balanced" | "creative";
  readonly textEmotionBias?: boolean;
  readonly expressivenessEnhancement?: boolean;
  readonly emotionBlend?: { readonly anger?: number; readonly happiness?: number; readonly neutral?: number; readonly sadness?: number; readonly contextual?: number };
  /** @minimum 0.5 @maximum 2 */ readonly speed?: number;
  /** @minimum 0 @maximum 2147483647 */ readonly randomSeed?: number;
  readonly output: Output;
}
interface Single extends Controls { readonly voice: string; readonly voiceSource?: "catalog" | "custom"; readonly text: string; readonly segments?: never; readonly latencyOptimization?: "aggressive" }
interface SpeechSegment { readonly text: string; readonly voice: string; readonly model: "v3.5"; readonly language?: Language; readonly output: Output; readonly speed?: number; readonly emotionBlend?: { readonly anger?: number; readonly happiness?: number; readonly neutral?: number; readonly sadness?: number; readonly contextual?: number }; readonly randomSeed?: number }
interface Composed { readonly text?: never; readonly voice?: never; readonly voiceSource?: never; readonly model?: never; readonly language?: never; readonly voiceVariant?: never; readonly deliveryVariation?: never; readonly textEmotionBias?: never; readonly expressivenessEnhancement?: never; readonly emotionBlend?: never; readonly speed?: never; readonly randomSeed?: never; readonly output?: never; readonly latencyOptimization?: never; readonly segments: readonly SpeechSegment[] }
export type TtsRequest = Single | Composed;
