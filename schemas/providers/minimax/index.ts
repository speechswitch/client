type Model =
  | "speech-2.8-hd" | "speech-2.8-turbo"
  | "speech-2.6-hd" | "speech-2.6-turbo"
  | "speech-02-hd" | "speech-02-turbo"
  | "speech-01-hd" | "speech-01-turbo";

type Language =
  | "Chinese" | "Chinese,Yue" | "English" | "Arabic" | "Russian" | "Spanish" | "French"
  | "Portuguese" | "German" | "Turkish" | "Dutch" | "Ukrainian" | "Vietnamese"
  | "Indonesian" | "Japanese" | "Italian" | "Korean" | "Thai" | "Polish" | "Romanian"
  | "Greek" | "Czech" | "Finnish" | "Hindi" | "Bulgarian" | "Danish" | "Hebrew"
  | "Malay" | "Persian" | "Slovak" | "Swedish" | "Croatian" | "Filipino" | "Hungarian"
  | "Norwegian" | "Slovenian" | "Catalan" | "Nynorsk" | "Tamil" | "Afrikaans" | "auto";

type Output =
  | {
      readonly format: "mp3";
      readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
      readonly bitRateBps: 32000 | 64000 | 128000 | 256000;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "wav";
      readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "flac";
      readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 32000 | 44100;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "mulaw";
      readonly sampleRateHz: 8000;
      readonly bitRateBps?: never;
    };

interface Common {
  /** @maxLength 9999 */
  readonly text: string;
  readonly voice: string;
  readonly language?: Language;
  readonly output: Output;
  /** @minimum 0.5 @maximum 2 */
  readonly speed?: number;
  /** @exclusiveMinimum 0 @maximum 10 */
  readonly volumeScale?: number;
  /** @minimum -12 @maximum 12 */
  readonly pitchSemitones?: number;
  readonly textNormalization?: boolean;
  readonly replacements?: readonly { readonly pattern: string; readonly replacement: string }[];
}

interface Speech26 extends Common {
  readonly model: "speech-2.6-hd" | "speech-2.6-turbo";
  readonly emotion?: "happy" | "sad" | "angry" | "fearful" | "disgusted" | "surprised" | "calm" | "fluent" | "whisper";
}

interface OtherModel extends Common {
  readonly model: Exclude<Model, Speech26["model"]>;
  readonly emotion?: "happy" | "sad" | "angry" | "fearful" | "disgusted" | "surprised" | "calm";
}

export type TtsRequest = Speech26 | OtherModel;
