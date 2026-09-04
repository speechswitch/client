type Output =
  | { readonly format: "wav"; readonly sampleRateHz?: 48000; readonly bitRateBps?: never }
  | {
      readonly format: "pcm";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
      readonly bitRateBps?: never;
    }
  | { readonly format: "ogg_opus"; readonly sampleRateHz?: 48000; readonly bitRateBps?: never }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz?: 8000; readonly bitRateBps?: never };

interface Common {
  readonly voice: string;
  readonly model: "tts" | "tts-beta";
  readonly output: Output;
}

interface SingleInput extends Common { readonly text: string }
interface StreamingInput extends Common { readonly text: AsyncIterable<string> }

export type TtsRequest = SingleInput | StreamingInput;
export type TtsRequestWithTimestamps = SingleInput | StreamingInput;
