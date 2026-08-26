interface Common {
  readonly voice: string;
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

interface CompleteInput extends Common {
  readonly text: string;
  readonly model?: "standard" | "neural" | "long-form" | "generative";
}

interface StreamingInput extends Common {
  readonly text: AsyncIterable<string>;
  readonly model: "generative";
}

interface CompleteMp3OrVorbis extends CompleteInput {
  readonly format: "mp3" | "ogg_vorbis";
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
}

interface CompletePcm extends CompleteInput {
  readonly format: "pcm";
  readonly sampleRateHz?: 8000 | 16000;
}

interface CompleteOpus extends CompleteInput {
  readonly format: "ogg_opus";
  readonly sampleRateHz?: 48000;
}

interface CompleteTelephony extends CompleteInput {
  readonly format: "alaw" | "mulaw";
  readonly sampleRateHz?: 8000;
}

interface StreamingMp3OrVorbis extends StreamingInput {
  readonly format: "mp3" | "ogg_vorbis";
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
}

interface StreamingPcm extends StreamingInput {
  readonly format: "pcm";
  readonly sampleRateHz?: 8000 | 16000;
}

interface StreamingOpus extends StreamingInput {
  readonly format: "ogg_opus";
  readonly sampleRateHz?: 48000;
}

interface StreamingTelephony extends StreamingInput {
  readonly format: "alaw" | "mulaw";
  readonly sampleRateHz?: 8000;
}

export type TtsRequest =
  | CompleteMp3OrVorbis
  | CompletePcm
  | CompleteOpus
  | CompleteTelephony
  | StreamingMp3OrVorbis
  | StreamingPcm
  | StreamingOpus
  | StreamingTelephony;
