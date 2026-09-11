type Language =
  | "auto"
  | "en"
  | "ar-EG"
  | "ar-SA"
  | "ar-AE"
  | "bn"
  | "zh"
  | "fr"
  | "de"
  | "hi"
  | "id"
  | "it"
  | "ja"
  | "ko"
  | "pt-BR"
  | "pt-PT"
  | "ru"
  | "es-MX"
  | "es-ES"
  | "tr"
  | "vi";

type Output =
  | {
      readonly codec: "mp3";
      readonly container?: never;
      readonly sampleFormat?: never;
      /** @serializeAs rest sample_rate */
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      /** @serializeAs rest bit_rate */
      readonly bitRateBps?: 32000 | 64000 | 96000 | 128000 | 192000;
    }
  | {
      readonly codec: "pcm";
      readonly container: "raw" | "wav";
      readonly sampleFormat?: "int16";
      /** @serializeAs rest sample_rate */
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      readonly bitRateBps?: never;
    }
  | {
      readonly codec: "alaw" | "mulaw";
      readonly container: "raw";
      readonly sampleFormat?: never;
      /** @serializeAs rest sample_rate */
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      readonly bitRateBps?: never;
    };

interface Common {
  /** @serializeAs rest voice_id
   * @serializeAs streaming voice */
  readonly voice?: string;
  readonly model?: "grok-tts";
  /** @default "auto" */
  readonly language?: Language;
  /** @serializeAs rest output_format */
  readonly output?: Output;
  /** @minimum 0.7 @maximum 1.5
   * @serializeAs rest speed
   * @serializeAs streaming speed */
  readonly speed?: number;
  /** @serializeAs rest text_normalization
   * @serializeAs streaming text_normalization */
  readonly textNormalization?: boolean;
  /** @serializeAs rest replace */
  readonly replacements?: Readonly<Record<string, string>>;
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
}

export type TtsInput =
  | string
  | { readonly command: "clear" }
  | { readonly command: "flush" }
  | {
      readonly command: "update";
      /** Replaces the session map for utterances starting after this update; {} removes it. */
      readonly replacements: Readonly<Record<string, string>>;
    };

interface SingleInput extends Common {
  readonly text: string;
}
interface StreamingInput extends Common {
  readonly text: AsyncIterable<TtsInput>;
}

export type TtsRequest = SingleInput | StreamingInput;

export type TtsRequestWithTimestamps = SingleInput | StreamingInput;
