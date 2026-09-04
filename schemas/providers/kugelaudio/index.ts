type Language =
  | "de" | "en" | "fr" | "es" | "it" | "pt" | "nl" | "pl" | "sv" | "da" | "no" | "fi"
  | "cs" | "hu" | "ro" | "el" | "uk" | "bg" | "tr" | "vi" | "ar" | "hi" | "zh" | "ja"
  | "ko" | "sk" | "sl" | "hr" | "sr" | "ru" | "he" | "fa" | "ur" | "bn" | "ta" | "yue"
  | "th" | "id" | "ms";

type Model =
  | "kugel-3" | "kugel-2.5" | "kugel-2-turbo" | "kugel-2" | "kugel-1" | "kugel-1-turbo";

type Output =
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "alaw" | "mulaw";
      readonly sampleRateHz?: 8000;
      readonly bitRateBps?: never;
    };

interface DictionarySelection {
  readonly projectId: number;
  readonly dictionaryIds?: readonly number[];
}

interface Common {
  readonly voice: string;
  readonly model: Model;
  readonly language?: Language;
  readonly output: Output;
  /** @minimum 0.8 @maximum 1.2 */
  readonly speed?: number;
  /** @minimum 0 @maximum 1 */
  readonly temperature?: number;
  /** @minimum 1.2 @maximum 2.5 */
  readonly guidanceScale?: number;
  /** @minimum 1 @maximum 2048 */
  readonly maxOutputTokens?: number;
  readonly textNormalization?: boolean;
  readonly dictionarySelection?: DictionarySelection;
  readonly timestampGranularity?: "word";
}

interface SingleInput extends Common {
  readonly text: string;
  readonly streamingBuffer?: never;
}

interface StreamingInput extends Common {
  readonly text: AsyncIterable<
    string | { readonly command: "clear" } | { readonly command: "flush" }
  >;
  readonly streamingBuffer?: {
    readonly maxDelayMs?: number;
    readonly characterThreshold?: number;
    readonly automatic?: never;
  };
}

export type TtsRequest = SingleInput | StreamingInput;
export type TtsRequestWithTimestamps = SingleInput | StreamingInput;
