type Output =
  | { readonly format: "mp3"; readonly sampleRateHz: 32000; readonly bitRateBps?: never }
  | { readonly format: "mp3"; readonly sampleRateHz: 22050; readonly bitRateBps: 32000 }
  | { readonly format: "mp3"; readonly sampleRateHz: 24000; readonly bitRateBps: 48000 }
  | { readonly format: "mp3"; readonly sampleRateHz: 44100; readonly bitRateBps: 32000 | 64000 | 96000 | 128000 | 192000 }
  | { readonly format: "wav"; readonly sampleRateHz: 16000 | 22050 | 24000 | 32000; readonly bitRateBps?: never }
  | { readonly format: "pcm"; readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000; readonly sampleEncoding?: "signed_integer_16"; readonly bitRateBps?: never }
  | { readonly format: "alaw" | "mulaw"; readonly sampleRateHz: 8000; readonly bitRateBps?: never }
  | { readonly format: "opus"; readonly sampleRateHz: 48000; readonly bitRateBps: 32000 | 64000 | 96000 | 128000 | 192000 };
interface Common {
  readonly text: string;
  readonly voice?: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly output: Output;
  /** @minimum 0 @maximum 2 */ readonly temperature?: number;
  /** @minimum 0 @maximum 1 */ readonly topProbabilityMass?: number;
  readonly dictionarySelection?: { readonly projectId?: never; readonly dictionaryIds: readonly string[]; readonly version?: number };
}
interface English extends Common { readonly model: "voiceai-tts-v1" | "voiceai-tts-v1-2026-02-10"; readonly language?: "en" }
interface Multilingual extends Common { readonly model: "voiceai-tts-multilingual-v1" | "voiceai-tts-multilingual-v1-2026-02-10"; readonly language: "en" | "ca" | "sv" | "es" | "fr" | "de" | "it" | "pt" | "pl" | "ru" | "nl" }
export type TtsRequest = English | Multilingual;
