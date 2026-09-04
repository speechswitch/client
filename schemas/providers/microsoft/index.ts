type Output =
  | {
      readonly format: "mp3";
      readonly sampleRateHz: 16000;
      readonly bitRateBps: 32000 | 64000 | 128000;
    }
  | {
      readonly format: "mp3";
      readonly sampleRateHz: 24000;
      readonly bitRateBps: 48000 | 96000 | 160000;
    }
  | {
      readonly format: "mp3";
      readonly sampleRateHz: 48000;
      readonly bitRateBps: 96000 | 192000;
    }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz: 16000 | 24000 | 48000;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "pcm";
      readonly sampleRateHz: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "wav";
      readonly sampleRateHz: 8000 | 22050 | 24000 | 44100 | 48000;
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "alaw" | "mulaw";
      readonly sampleRateHz: 8000;
      readonly bitRateBps?: never;
    };

interface Common {
  readonly text: string;
  readonly output: Output;
}

interface TextInput extends Common {
  readonly inputType?: "text";
  readonly voice: string;
  readonly language: string;
}

interface SsmlInput extends Common {
  readonly inputType: "ssml";
  readonly voice?: never;
  readonly language?: never;
}

export type TtsRequest = TextInput | SsmlInput;
