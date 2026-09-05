interface PcmSamples {
  readonly sampleEncoding?: "signed_integer_16";
  readonly byteOrder?: "little_endian";
  readonly bitRateBps?: never;
  /** @default 48000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
}
interface Pcm extends PcmSamples { readonly format: "pcm" }
interface Wav extends PcmSamples { readonly format: "wav" }
interface Encoded {
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface Mp3 extends Encoded {
  readonly format: "mp3";
  /** @default 48000 */
  readonly sampleRateHz?: 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  /** @minimum 32000 @maximum 320000 @default 128000 */
  readonly bitRateBps?: number;
}
interface Opus extends Encoded {
  readonly format: "ogg_opus";
  /** @default 48000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  /** @minimum 32000 @maximum 192000 @default 128000 */
  readonly bitRateBps?: number;
}
interface Telephony extends Encoded {
  readonly format: "mulaw" | "alaw";
  /** @default 8000 */
  readonly sampleRateHz?: 8000;
  readonly bitRateBps?: never;
}
interface Flac extends Encoded {
  readonly format: "flac";
  /** @default 48000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  readonly bitRateBps?: never;
}

interface Settings {
  /** Library or existing custom voice ID; voice enrollment is a separate operation. @pattern ^[\s\S]+$ */
  readonly voice: string;
  /** Omission preserves native language detection, rather than forcing English. */
  readonly language?: string;
  /** @minimum 0.5 @maximum 1.5 @default 1 */
  readonly speed?: number;
  /** @default "auto" */
  readonly textNormalization?: boolean | "auto";
  readonly timestampGranularity?: "word" | "character";
  /** Trailing alignment prioritizes first audio; chunk delivery retains native association. @default "trailing" */
  readonly timestampDelivery?: "chunk" | "trailing";
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly voiceDescription?: never;
  readonly voiceName?: never;
}
interface StaticInput extends Settings {
  /** Whole input uses HTTP streaming by default. @pattern ^[\s\S]{1,4000}$ */
  readonly text: string;
  readonly output: Pcm | Wav | Mp3 | Opus | Telephony | Flac;
  /** Ordered earlier request texts; their combined length may not exceed 2000 characters. */
  readonly contextBefore?: { readonly texts: readonly string[]; readonly text?: never; readonly requestIds?: never; readonly turns?: never };
  /** Native output denoising, available over HTTP. @default false */
  readonly audioEnhancement?: boolean;
  readonly textFlushDelayMs?: never;
  readonly textBufferThreshold?: never;
  readonly automaticTextFlushing?: never;
}
interface StreamingInput extends Settings {
  /** Incremental text; flush starts generation without closing the context. No native clear command exists. */
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  /** FLAC is not in the documented WebSocket encoding set. */
  readonly output: Pcm | Wav | Mp3 | Opus | Telephony;
  /** Zero disables the idle timer; text length and explicit flush can still trigger generation. @minimum 0 @maximum 2147483647 @default 0 */
  readonly textFlushDelayMs?: number;
  /** Zero uses the native 1000-character default. @minimum 0 @maximum 2000 @default 1000 */
  readonly textBufferThreshold?: number;
  /** Recommended when each input chunk is a complete phrase. @default false */
  readonly automaticTextFlushing?: boolean;
  readonly contextBefore?: never;
  readonly audioEnhancement?: never;
  /** WebSocket steering uses inline tags, not a request-level instruction field. */
  readonly instructions?: never;
}

export interface Tts2Request extends StaticInput {
  readonly model: "inworld-tts-2";
  /** English-language delivery instruction; inline tags can override it. */
  readonly instructions?: string;
  /** @default "balanced" */
  readonly deliveryMode?: "stable" | "balanced" | "creative";
  readonly temperature?: never;
}
export interface Tts2StreamingRequest extends StreamingInput {
  readonly model: "inworld-tts-2";
  /** @default "balanced" */
  readonly deliveryMode?: "stable" | "balanced" | "creative";
  readonly temperature?: never;
}
export interface OtherModelsRequest extends StaticInput {
  /** TTS-1.5 aliases are deprecated upstream; Flash is the current non-steerable model. */
  readonly model: "inworld-tts-2-flash" | "inworld-tts-1.5-max" | "inworld-tts-1.5-mini";
  readonly instructions?: never;
  readonly deliveryMode?: never;
  /** Zero selects the native default, not deterministic sampling. @minimum 0 @maximum 2 @default 1 */
  readonly temperature?: number;
}
export interface OtherModelsStreamingRequest extends StreamingInput {
  /** TTS-1.5 aliases are deprecated upstream; Flash is the current non-steerable model. */
  readonly model: "inworld-tts-2-flash" | "inworld-tts-1.5-max" | "inworld-tts-1.5-mini";
  readonly deliveryMode?: never;
  /** Zero selects the native default, not deterministic sampling. @minimum 0 @maximum 2 @default 1 */
  readonly temperature?: number;
}

/** Inworld realtime synthesis, narrowed by model and input transport capabilities. */
export type TtsRequest = Tts2Request | Tts2StreamingRequest | OtherModelsRequest | OtherModelsStreamingRequest;
