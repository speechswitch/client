type Output =
  | { readonly format: "mp3"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "pcm"; readonly sampleRateHz?: never; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz?: never; readonly bitRateBps?: never };

interface Common {
  readonly output: Output;
  readonly speed?: number;
  readonly deliveryInstructions?: string;
  readonly trailingSilenceSeconds?: number;
  readonly temperature?: number;
  readonly continuityId?: string;
}

interface Octave1SingleWithoutVoice extends Common {
  readonly text: string;
  readonly model: "octave-1";
  readonly voice?: never;
  readonly voiceSource?: never;
  readonly latencyOptimization?: "none";
}

interface Octave1StreamingWithoutVoice extends Common {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly model: "octave-1";
  readonly voice?: never;
  readonly voiceSource?: never;
  readonly latencyOptimization?: "none";
}

interface Octave1SingleWithVoice extends Common {
  readonly text: string;
  readonly model: "octave-1";
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly latencyOptimization?: "none" | "aggressive";
}

interface Octave1StreamingWithVoice extends Common {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly model: "octave-1";
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly latencyOptimization?: "none" | "aggressive";
}

interface Octave2Single extends Common {
  readonly text: string;
  readonly model: "octave-2";
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly latencyOptimization?: "none" | "aggressive";
}

interface Octave2Streaming extends Common {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly model: "octave-2";
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  readonly latencyOptimization?: "none" | "aggressive";
}

export type TtsRequest =
  | Octave1SingleWithoutVoice
  | Octave1StreamingWithoutVoice
  | Octave1SingleWithVoice
  | Octave1StreamingWithVoice
  | Octave2Single
  | Octave2Streaming;

export type TtsRequestWithTimestamps = Octave2Single | Octave2Streaming;
