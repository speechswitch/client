type V21Language = "ara" | "bul" | "ces" | "dan" | "deu" | "ell" | "eng" | "fin" | "fra" | "hrv" | "ind" | "ita" | "jpn" | "kor" | "msa" | "nld" | "pol" | "por" | "ron" | "rus" | "slk" | "spa" | "swe" | "tam" | "tgl" | "ukr" | "zho";
type V30Language = V21Language | "ben" | "hin" | "hun" | "nan" | "nor" | "pan" | "tha" | "tur" | "vie" | "yue";
type Format =
  | { readonly format: "wav"; readonly sampleRateHz: 44100; readonly bitRateBps?: never }
  | { readonly format: "mp3"; readonly sampleRateHz: 44100; readonly bitRateBps?: 320000 };
type StreamFormat =
  | { readonly format: "wav"; readonly sampleRateHz: 32000; readonly bitRateBps?: never }
  | { readonly format: "mp3"; readonly sampleRateHz: 44100; readonly bitRateBps?: 320000 };
interface Controls {
  readonly voice: string;
  readonly voiceSource?: "catalog" | "custom";
  /** @minimum 0.5 @maximum 2 */ readonly speed?: number;
  /** @minimum 0 @maximum 2 */ readonly volumeScale?: number;
  /** @minimum -12 @maximum 12 */ readonly pitchSemitones?: number;
  /** @minimum -70 @maximum 0 */ readonly targetLoudnessLufs?: number;
  /** @minimum 0 @maximum 2 */ readonly emotionIntensity?: number;
  readonly surroundingContext?: { readonly previous?: string; readonly next?: string };
  /** @minimum 0 @maximum 4294967295 */ readonly randomSeed?: number;
}
interface V21 extends Controls { readonly model: "ssfm-v21"; readonly language?: V21Language; readonly emotion?: "normal" | "happy" | "sad" | "angry" }
interface V30 extends Controls { readonly model: "ssfm-v30"; readonly language?: V30Language; readonly emotion?: "normal" | "happy" | "sad" | "angry" | "whisper" | "toneup" | "tonedown" }
interface BufferedSingle { /** @minLength 1 @maxLength 2000 */ readonly text: string; readonly output: Format; readonly latencyOptimization: "none"; readonly segments?: never }
interface StreamedSingle { /** @minLength 1 @maxLength 2000 */ readonly text: string; readonly output: StreamFormat; readonly latencyOptimization?: "aggressive"; readonly segments?: never }
interface TypecastSpeechSegment { readonly text: string; readonly voice: string; readonly model: "ssfm-v21" | "ssfm-v30"; readonly language?: V30Language; readonly output: Format; readonly speed?: number; readonly volumeScale?: number; readonly pitchSemitones?: number; readonly targetLoudnessLufs?: number; readonly emotion?: string; readonly emotionIntensity?: number; readonly surroundingContext?: { readonly previous?: string; readonly next?: string }; readonly randomSeed?: number }
interface TypecastPauseSegment { /** @minimum 0 @maximum 10 */ readonly pauseSeconds: number }
interface Composed { readonly text?: never; readonly voice?: never; readonly voiceSource?: never; readonly model?: never; readonly language?: never; readonly output?: never; readonly speed?: never; readonly volumeScale?: never; readonly pitchSemitones?: never; readonly targetLoudnessLufs?: never; readonly emotion?: never; readonly emotionIntensity?: never; readonly surroundingContext?: never; readonly randomSeed?: never; readonly latencyOptimization?: never; /** @minItems 1 @maxItems 50 */ readonly segments: readonly (TypecastSpeechSegment | TypecastPauseSegment)[] }
interface V21Buffered extends V21, BufferedSingle {}
interface V21Streamed extends V21, StreamedSingle {}
interface V30Buffered extends V30, BufferedSingle {}
interface V30Streamed extends V30, StreamedSingle {}
export type TtsRequest = V21Buffered | V21Streamed | V30Buffered | V30Streamed | Composed;
interface Timestamped { readonly text: string; readonly output: Format; readonly timestampGranularity?: "word" | "character"; readonly latencyOptimization?: never; readonly segments?: never }
interface V21Timestamped extends V21, Timestamped {}
interface V30Timestamped extends V30, Timestamped {}
export type TtsRequestWithTimestamps = V21Timestamped | V30Timestamped;
