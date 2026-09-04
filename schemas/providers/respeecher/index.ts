type WavOutput = {
  readonly format: "wav";
  readonly sampleRateHz: number;
  readonly bitRateBps?: never;
};

type StreamingOutput =
  | {
      readonly format: "pcm";
      readonly sampleRateHz: number;
      readonly sampleEncoding: "signed_integer_16" | "float_32";
      readonly bitRateBps?: never;
    }
  | {
      readonly format: "mulaw";
      readonly sampleRateHz: number;
      readonly bitRateBps?: never;
    };

interface Common {
  readonly voice: string;
  readonly model: "realtime-tts";
  readonly language: "en" | "uk";
  readonly randomSeed?: number;
  /** @minimum 0 */
  readonly temperature?: number;
  /** -1 disables top-k filtering; all other values must be positive. @minimum -1 */
  readonly topTokenCount?: number;
  /** @minimum 0 @maximum 1 */
  readonly topProbabilityMass?: number;
  /** @minimum 0 @maximum 1 */
  readonly minimumTokenProbability?: number;
  /** @minimum 0 @maximum 2 */
  readonly presencePenalty?: number;
  /** @minimum 1 @maximum 2 */
  readonly repetitionPenalty?: number;
  /** @minimum 0 @maximum 2 */
  readonly frequencyPenalty?: number;
}

interface WavRequest extends Common {
  readonly text: string;
  readonly output: WavOutput;
  readonly continuityId?: never;
}

interface StaticStreamingRequest extends Common {
  readonly text: string;
  readonly output: StreamingOutput;
  readonly continuityId?: never;
}

interface IncrementalRequest extends Common {
  readonly text: AsyncIterable<string | { readonly command: "clear" }>;
  readonly output: StreamingOutput;
  readonly continuityId?: string;
}

export type TtsRequest = WavRequest | StaticStreamingRequest | IncrementalRequest;
