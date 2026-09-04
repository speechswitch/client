type Language = "en" | "es" | "de" | "nl" | "fr" | "it" | "ja";

type RestOutput =
  | { readonly format: "mp3"; readonly sampleRateHz?: 22050; readonly bitRateBps?: 32000 | 48000 }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: 8000 | 16000 | 24000 | 32000 | 48000;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "wav";
      readonly sampleRateHz?: 8000 | 16000 | 24000 | 32000 | 48000;
      readonly bitRateBps?: never;
    }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz?: 8000 | 16000; readonly bitRateBps?: never }
  | { readonly format: "ogg_opus"; readonly sampleRateHz?: 48000; readonly bitRateBps?: never }
  | { readonly format: "flac"; readonly bitRateBps?: number }
  | { readonly format: "aac"; readonly bitRateBps?: number };

type StreamingOutput =
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: 8000 | 16000 | 24000 | 32000 | 48000;
      readonly bitRateBps?: never;
    }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz?: 8000 | 16000; readonly bitRateBps?: never };

interface Common {
  readonly voice: string;
  readonly model: "aura-1" | "aura-2";
  readonly language: Language;
  /** @minimum 0.7 @maximum 1.5 */
  readonly speed?: number;
}

interface SingleInput extends Common {
  readonly text: string;
  readonly output: RestOutput;
}

interface StreamingInput extends Common {
  readonly text: AsyncIterable<string | { readonly command: "clear" }>;
  readonly output: StreamingOutput;
}

export type TtsRequest = SingleInput | StreamingInput;
