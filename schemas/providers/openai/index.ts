type Output =
  | { readonly format: "mp3"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "ogg_opus"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "aac"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "flac"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "pcm"; readonly sampleRateHz?: never; readonly bitRateBps?: never };

interface Common {
  /** @maxLength 4096 */
  readonly text: string;
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly output: Output;
  /** @minimum 0.25 @maximum 4 */
  readonly speed?: number;
}

interface GptSpeech extends Common {
  readonly model: "gpt-4o-mini-tts" | "gpt-4o-mini-tts-2025-12-15";
  /** @maxLength 4096 */
  readonly deliveryInstructions?: string;
}

interface LegacySpeech extends Common {
  readonly model: "tts-1" | "tts-1-hd";
  readonly deliveryInstructions?: never;
}

export type TtsRequest = GptSpeech | LegacySpeech;
