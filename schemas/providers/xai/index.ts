type Language =
  | "auto" | "en" | "ar-EG" | "ar-SA" | "ar-AE" | "bn" | "zh" | "fr" | "de"
  | "hi" | "id" | "it" | "ja" | "ko" | "pt-BR" | "pt-PT" | "ru" | "es-MX"
  | "es-ES" | "tr" | "vi";

type Output =
  | {
      readonly format: "mp3";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      readonly bitRateBps?: 32000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly format: "wav" | "pcm" | "alaw" | "mulaw";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      readonly bitRateBps?: never;
    };

interface Common {
  readonly voice?: string;
  readonly model?: "grok-tts";
  /** @default "auto" */
  readonly language?: Language;
  readonly output?: Output;
  /** @minimum 0.7 @maximum 1.5 */
  readonly speed?: number;
  readonly textNormalization?: boolean;
  readonly replacements?: readonly {
    readonly pattern: string;
    readonly replacement: string;
  }[];
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
  readonly timestampGranularity?: "character";
}

export type TtsInput =
  | string
  | { readonly command: "clear" }
  | { readonly command: "flush" }
  | {
      readonly command: "update";
      /** Replaces the session map for utterances starting after this update; [] removes it. */
      readonly replacements: readonly { readonly pattern: string; readonly replacement: string }[];
    };

interface SingleInput extends Common { readonly text: string }
interface StreamingInput extends Common {
  readonly text: AsyncIterable<TtsInput>;
}

export type TtsRequest = SingleInput | StreamingInput;
