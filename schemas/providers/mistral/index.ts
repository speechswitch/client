type Output =
  | { readonly format: "mp3"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "pcm"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "flac"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "ogg_opus"; readonly sampleRateHz?: never; readonly bitRateBps?: never };

interface Common {
  readonly text: string;
  readonly model: "voxtral-mini-tts-2603";
  readonly output: Output;
}

interface SavedVoice extends Common {
  readonly voice: string;
  readonly referenceAudio?: never;
}

interface ReferenceVoice extends Common {
  readonly voice?: never;
  readonly referenceAudio: Uint8Array;
}

export type TtsRequest = SavedVoice | ReferenceVoice;
