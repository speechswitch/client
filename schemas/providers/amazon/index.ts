interface Common {
  readonly voice: string;
  readonly output: Output;
  readonly inputType?: "text" | "ssml";
  readonly language?:
    | "arb" | "cmn-CN" | "cy-GB" | "da-DK" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS"
    | "en-IN" | "en-US" | "es-ES" | "es-MX" | "es-US" | "fr-CA" | "fr-FR" | "is-IS"
    | "it-IT" | "ja-JP" | "hi-IN" | "ko-KR" | "nb-NO" | "nl-NL" | "pl-PL" | "pt-BR"
    | "pt-PT" | "ro-RO" | "ru-RU" | "sv-SE" | "tr-TR" | "en-NZ" | "en-ZA" | "ca-ES"
    | "de-AT" | "yue-CN" | "ar-AE" | "fi-FI" | "en-IE" | "nl-BE" | "fr-BE" | "cs-CZ"
    | "de-CH" | "en-SG";
  readonly lexicon?: string | readonly string[];
}

type Output =
  | {
      readonly format: "mp3" | "ogg_vorbis";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: 8000 | 16000;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz?: 48000;
    }
  | {
      readonly format: "alaw" | "mulaw";
      readonly sampleRateHz?: 8000;
    };

interface SingleInput extends Common {
  readonly text: string;
  readonly model?: "standard" | "neural" | "long-form" | "generative";
}

interface StreamingInput extends Common {
  readonly text: AsyncIterable<string>;
  readonly model: "generative";
}

export interface TtsRequestWithTimestamps extends Common {
  readonly text: string;
  readonly model?: "standard" | "neural" | "long-form" | "generative";
  readonly timestampKinds: readonly [
    "sentence" | "ssml" | "viseme" | "word",
    ...("sentence" | "ssml" | "viseme" | "word")[],
  ];
}

export type TtsRequest = SingleInput | StreamingInput;
