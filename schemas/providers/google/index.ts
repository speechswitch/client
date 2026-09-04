type Output =
  | { readonly format: "mp3"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "pcm"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "ogg_opus"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz?: number; readonly bitRateBps?: never }
  | { readonly format: "aac"; readonly sampleRateHz?: number; readonly bitRateBps?: never };

export type TtsRequest = {
  readonly text: string;
  readonly voice?: string;
  readonly inputType: "text" | "ssml";
  readonly model: "chirp-3-hd" | "gemini-2.5-flash-lite-tts" | "gemini-2.5-flash-tts" | "gemini-2.5-pro-tts";
  readonly language: string;
  readonly output: Output;
  /** @minimum 0.25 @maximum 2 */
  readonly speed?: number;
  /** @minimum -96 @maximum 16 */
  readonly volumeDb?: number;
  /** @minimum -20 @maximum 20 */
  readonly pitchSemitones?: number;
};
