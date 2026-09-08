type SampleRate = 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
type StreamingOutput =
  | { readonly format: "mp3"; readonly sampleRateHz: 22050; readonly bitRateBps: 32000; readonly sampleEncoding?: never; readonly byteOrder?: never }
  | { readonly format: "mp3"; readonly sampleRateHz: 24000; readonly bitRateBps: 48000; readonly sampleEncoding?: never; readonly byteOrder?: never }
  | { readonly format: "mp3"; readonly sampleRateHz?: 44100; readonly bitRateBps?: 32000 | 64000 | 96000 | 128000 | 192000; readonly sampleEncoding?: never; readonly byteOrder?: never }
  | { readonly format: "ogg_opus"; readonly sampleRateHz?: 48000; readonly bitRateBps?: 32000 | 64000 | 96000 | 128000 | 192000; readonly sampleEncoding?: never; readonly byteOrder?: never }
  | { readonly format: "pcm"; readonly sampleRateHz: SampleRate; readonly sampleEncoding?: "signed_integer_16"; readonly byteOrder?: "little_endian"; readonly bitRateBps?: never }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz?: 8000; readonly bitRateBps?: never; readonly sampleEncoding?: never; readonly byteOrder?: never };
type Output = StreamingOutput | { readonly format: "wav"; readonly sampleRateHz: SampleRate; readonly sampleEncoding?: "signed_integer_16"; readonly byteOrder?: "little_endian"; readonly bitRateBps?: never };
type Context = { readonly text: string; readonly requestIds?: never } | { readonly requestIds: readonly string[]; readonly text?: never };

interface Common {
  /** Existing library, designed, or cloned voice ID; creating a voice is a separate API.
   * @pattern ^.+$
   */
  readonly voice: string;
  /** @minimum 0 @maximum 1 */
  readonly stability?: number;
  /** @minimum 0 @maximum 4294967295 @integer */
  readonly randomSeed?: number;
}
interface Flash {
  readonly model: "flash-v2" | "flash-v2.5";
  readonly language?: string;
}
interface Multilingual {
  readonly model: "multilingual-v2";
  readonly language?: never;
}
interface V3 {
  readonly model: "eleven-v3";
  readonly language?: string;
  readonly speed?: never;
  readonly voiceSimilarity?: never;
  readonly styleExaggeration?: never;
  readonly voiceBoost?: never;
}
interface VoiceControls {
  /** @minimum 0.7 @maximum 1.2 */
  readonly speed?: number;
  /** @minimum 0 @maximum 1 */
  readonly voiceSimilarity?: number;
  /** @minimum 0 @maximum 1 */
  readonly styleExaggeration?: number;
  readonly voiceBoost?: boolean;
}
interface Http {
  readonly text: string;
  readonly output: Output;
  readonly pronunciationDictionaries?: readonly {
    /** @pattern ^.+$ */
    readonly id: string;
    /** @pattern ^.+$ */
    readonly versionId?: string;
  }[];
  readonly contextBefore?: Context;
  readonly contextAfter?: Context;
  /** Japanese-specific normalization; independent of general text normalization. */
  readonly languageTextNormalization?: boolean;
  readonly textBufferThresholds?: never;
  readonly textBuffering?: never;
  readonly inputType?: never;
}
interface HttpNormalization {
  /** Omission selects provider automatic normalization. */
  readonly textNormalization?: boolean | "auto";
  /** Deprecated upstream. */
  readonly latencyOptimization?: "none" | "moderate" | "strong" | "aggressive";
}
interface MaximumOptimization {
  /** Deprecated upstream; also disables text normalization. */
  readonly latencyOptimization: "maximum";
  readonly textNormalization?: false;
}
interface Live {
  readonly textNormalization?: boolean | "auto";
  readonly output: StreamingOutput;
  readonly pronunciationDictionaries?: readonly {
    /** @pattern ^.+$ */
    readonly id: string;
    /** @pattern ^.+$ */
    readonly versionId: string;
  }[];
  readonly contextBefore?: never;
  readonly contextAfter?: never;
  readonly languageTextNormalization?: never;
  readonly latencyOptimization?: never;
}
interface TtsLive extends Live {
  readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>;
  readonly inputType?: "text" | "ssml";
}
interface Buffered {
  readonly textBuffering?: true;
  /** Successive character thresholds, each in [50, 500]; last repeats. */
  readonly textBufferThresholds?: readonly number[];
}
interface Unbuffered {
  readonly textBuffering: false;
  readonly textBufferThresholds?: never;
}
interface DialogueLive extends Live {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly inputType?: never;
  readonly textBuffering?: never;
  readonly textBufferThresholds?: never;
}
interface Untimed {
  readonly timestampGranularity?: never;
  readonly timestampText?: never;
}
interface Timed {
  readonly timestampGranularity: "character";
  readonly timestampText?: "original" | "normalized";
}
interface DialogueTimed {
  readonly timestampGranularity: "character";
  /** Dialogue normalized_alignment is reserved and currently unused by the server. */
  readonly timestampText?: "original";
}
interface FlashHttp extends Common, Flash, VoiceControls, Http, HttpNormalization, Untimed {}
interface MultilingualHttp extends Common, Multilingual, VoiceControls, Http, HttpNormalization, Untimed {}
interface V3Http extends Common, V3, Http, HttpNormalization, Untimed {}
interface FlashTimedHttp extends Common, Flash, VoiceControls, Http, HttpNormalization, Timed {}
interface MultilingualTimedHttp extends Common, Multilingual, VoiceControls, Http, HttpNormalization, Timed {}
interface V3TimedHttp extends Common, V3, Http, HttpNormalization, Timed {}
interface FlashMaximumHttp extends Common, Flash, VoiceControls, Http, MaximumOptimization, Untimed {}
interface MultilingualMaximumHttp extends Common, Multilingual, VoiceControls, Http, MaximumOptimization, Untimed {}
interface V3MaximumHttp extends Common, V3, Http, MaximumOptimization, Untimed {}
interface FlashMaximumTimedHttp extends Common, Flash, VoiceControls, Http, MaximumOptimization, Timed {}
interface MultilingualMaximumTimedHttp extends Common, Multilingual, VoiceControls, Http, MaximumOptimization, Timed {}
interface V3MaximumTimedHttp extends Common, V3, Http, MaximumOptimization, Timed {}
interface FlashStreaming extends Common, Flash, VoiceControls, TtsLive, Buffered, Untimed {}
interface MultilingualStreaming extends Common, Multilingual, VoiceControls, TtsLive, Buffered, Untimed {}
interface V3Streaming extends Common, V3, DialogueLive, Untimed {}
interface FlashTimedStreaming extends Common, Flash, VoiceControls, TtsLive, Buffered, Timed {}
interface MultilingualTimedStreaming extends Common, Multilingual, VoiceControls, TtsLive, Buffered, Timed {}
interface FlashUnbufferedStreaming extends Common, Flash, VoiceControls, TtsLive, Unbuffered, Untimed {}
interface MultilingualUnbufferedStreaming extends Common, Multilingual, VoiceControls, TtsLive, Unbuffered, Untimed {}
interface FlashUnbufferedTimedStreaming extends Common, Flash, VoiceControls, TtsLive, Unbuffered, Timed {}
interface MultilingualUnbufferedTimedStreaming extends Common, Multilingual, VoiceControls, TtsLive, Unbuffered, Timed {}
interface V3TimedStreaming extends Common, V3, DialogueLive, DialogueTimed {}

export type TtsRequest = FlashHttp | MultilingualHttp | V3Http | FlashTimedHttp | MultilingualTimedHttp | V3TimedHttp
  | FlashMaximumHttp | MultilingualMaximumHttp | V3MaximumHttp | FlashMaximumTimedHttp | MultilingualMaximumTimedHttp | V3MaximumTimedHttp
  | FlashStreaming | MultilingualStreaming | V3Streaming | FlashTimedStreaming | MultilingualTimedStreaming | V3TimedStreaming
  | FlashUnbufferedStreaming | MultilingualUnbufferedStreaming | FlashUnbufferedTimedStreaming | MultilingualUnbufferedTimedStreaming;
