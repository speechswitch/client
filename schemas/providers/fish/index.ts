interface Audio {
  /** Omission uses 44100 Hz, or 48000 Hz for Opus. @integer @minimum 1 */
  readonly sampleRateHz?: number;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface Mp3 extends Audio {
  readonly format: "mp3";
  /** @default 128000 */
  readonly bitRateBps?: 64000 | 128000 | 192000;
}
interface Opus extends Audio {
  readonly format: "ogg_opus";
  /** Omission lets the encoder select the bitrate automatically. */
  readonly bitRateBps?: 24000 | 32000 | 48000 | 64000;
}
interface Uncompressed extends Audio {
  readonly format: "wav" | "pcm";
  readonly bitRateBps?: never;
}
interface ReferenceSample {
  /** WAV, MP3 or FLAC bytes. */
  readonly audio: Uint8Array;
  /** Exact transcript of the recording. @pattern ^[\s\S]+$ */
  readonly text: string;
}
interface Common {
  readonly output: Mp3 | Opus | Uncompressed;
  /** @minimum 0.5 @maximum 2 @default 1 */
  readonly speed?: number;
  /** @default 0 */
  readonly volumeDb?: number;
  /** @minimum 0 @maximum 1 @default 0.7 */
  readonly temperature?: number;
  /** @minimum 0 @maximum 1 @default 0.7 */
  readonly topP?: number;
  /** @integer @minimum 100 @maximum 300 @default 300 */
  readonly textChunkLength?: number;
  /** @integer @minimum 0 @maximum 100 @default 50 */
  readonly minTextChunkLength?: number;
  /** @integer @default 1024 */
  readonly maxAudioTokens?: number;
  /** @default 1.2 */
  readonly repetitionPenalty?: number;
  /** @default true */
  readonly conditionOnPreviousChunks?: boolean;
  /** @minimum 0 @maximum 1 @default 1 */
  readonly earlyStopThreshold?: number;
  /** @default true */
  readonly textNormalization?: boolean;
  /** @default "none" */
  readonly latencyOptimization?: "none" | "moderate" | "aggressive";
  readonly features?: readonly string[];
}
interface Voice {
  /** Catalog or existing custom voice ID. @pattern ^.+$ */
  readonly voice: string;
  /** @minItems 1 */
  readonly referenceSamples?: readonly ReferenceSample[];
  readonly speakers?: never;
}
interface Reference {
  /** @pattern ^.+$ */
  readonly voice?: string;
  /** @minItems 1 */
  readonly referenceSamples: readonly ReferenceSample[];
  readonly speakers?: never;
}
interface Dialogue {
  readonly voice?: never;
  readonly referenceSamples?: never;
  /** Text uses <|speaker:0|>, <|speaker:1|>, etc., indexing this array. @minItems 1 */
  readonly speakers:
    | readonly {
        /** @pattern ^.+$ */
        readonly voice: string;
        readonly referenceSamples?: never;
      }[]
    | readonly {
        readonly voice?: never;
        /** @minItems 1 */
        readonly referenceSamples: readonly ReferenceSample[];
      }[];
}
interface S1 {
  readonly model: "s1";
  readonly loudnessNormalization?: never;
}
interface S2 {
  readonly model: "s2-pro" | "s2.1-pro" | "s2.1-pro-free";
  /** @default true */
  readonly loudnessNormalization?: boolean;
}
interface Http {
  readonly text: string;
  /** Native text segments, not guaranteed to be individual words. */
  readonly timestampGranularity?: "segment";
}
interface Live {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly timestampGranularity?: never;
}
interface S1VoiceHttp extends Common, S1, Voice, Http {}
interface S1ReferenceHttp extends Common, S1, Reference, Http {}
interface S1VoiceLive extends Common, S1, Voice, Live {}
interface S1ReferenceLive extends Common, S1, Reference, Live {}
interface S2VoiceHttp extends Common, S2, Voice, Http {}
interface S2ReferenceHttp extends Common, S2, Reference, Http {}
interface S2DialogueHttp extends Common, S2, Dialogue, Http {}
interface S2VoiceLive extends Common, S2, Voice, Live {}
interface S2ReferenceLive extends Common, S2, Reference, Live {}
interface S2DialogueLive extends Common, S2, Dialogue, Live {}

export type TtsRequest = S1VoiceHttp | S1ReferenceHttp | S1VoiceLive | S1ReferenceLive
  | S2VoiceHttp | S2ReferenceHttp | S2DialogueHttp | S2VoiceLive | S2ReferenceLive | S2DialogueLive;

export type SegmentTimestamp = {
  readonly kind: "segment";
  readonly value: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
};

/** Native chunk_seq groups may receive revised snapshots independently of audio packets. */
export type TimelineOutput = {
  readonly correlation: "timeline";
  readonly correlationId: string;
  readonly timelineOffsetMs: number;
  readonly audio: Uint8Array;
  readonly timestamps: readonly SegmentTimestamp[];
  /** Replace the group's entire list, including an empty list. Omission leaves it unchanged. */
  readonly timestampUpdate?: "replace";
  /** Native duration of the alignment group, not this packet's audio bytes. */
  readonly durationMs?: number;
};

export type SynthesisItem = Uint8Array | TimelineOutput;
