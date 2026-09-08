type NonEnglish = "ca" | "sv" | "es" | "fr" | "de" | "it" | "pt" | "pl" | "ru" | "nl";
export type TtsInput = string | { readonly command: "flush" } | { readonly command: "clear" };

interface Encoded {
  readonly constantBitRate?: never;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  readonly channelCount?: never;
}
interface Pcm {
  readonly constantBitRate?: never;
  readonly format: "pcm";
  /** @default 32000 */
  readonly sampleRateHz?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  /** @default "signed_integer_16" */
  readonly sampleEncoding?: "signed_integer_16";
  /** @default "little_endian" */
  readonly byteOrder?: "little_endian";
  /** @default 1 */
  readonly channelCount?: 1;
  readonly bitRateBps?: never;
}
interface Telephony extends Encoded {
  readonly format: "mulaw" | "alaw";
  /** @default 8000 */
  readonly sampleRateHz?: 8000;
  readonly bitRateBps?: never;
}
interface Wav extends Encoded {
  readonly format: "wav";
  /** @default 32000 */
  readonly sampleRateHz?: 16000 | 22050 | 24000 | 32000;
  readonly bitRateBps?: never;
}
interface Mp3 extends Encoded {
  readonly format: "mp3";
  /** Native basic MP3 does not specify a selectable bitrate. @default 32000 */
  readonly sampleRateHz?: 32000;
  readonly bitRateBps?: never;
}
interface Mp3Low extends Encoded {
  readonly format: "mp3";
  readonly sampleRateHz: 22050;
  /** @default 32000 */
  readonly bitRateBps?: 32000;
}
interface Mp3Voice extends Encoded {
  readonly format: "mp3";
  readonly sampleRateHz: 24000;
  /** @default 48000 */
  readonly bitRateBps?: 48000;
}
interface Mp3High extends Encoded {
  readonly format: "mp3";
  readonly sampleRateHz: 44100;
  readonly bitRateBps: 32000 | 64000 | 96000 | 128000 | 192000;
}
interface Opus extends Encoded {
  /** Native Opus; the upstream contract does not specify an Ogg container. */
  readonly format: "opus";
  /** @default 48000 */
  readonly sampleRateHz?: 48000;
  readonly bitRateBps: 32000 | 64000 | 96000 | 128000 | 192000;
}
type Output = Pcm | Telephony | Wav | Mp3 | Mp3Low | Mp3Voice | Mp3High | Opus;

interface Settings {
  /** @default "v1" */
  readonly apiVersion?: "v1";
  /** Text buffers until flush or input EOF. Clear closes old contexts and suppresses their audio; it is not guaranteed inference cancellation. */
  readonly text: string | AsyncIterable<TtsInput>;
  /** Existing built-in or cloned voice ID; omit to use the native default voice. */
  readonly voice?: string;
  /** @minimum 0 @maximum 2 @default 1 */
  readonly temperature?: number;
  /** @minimum 0 @maximum 1 @default 0.8 */
  readonly topP?: number;
  /** One existing managed dictionary; omit its numeric version for latest. @minItems 1 @maxItems 1 */
  readonly pronunciationDictionaries?: readonly {
    readonly id: string;
    /** @integer @minimum 1 */
    readonly version?: number;
    readonly versionId?: never;
  }[];
  readonly timestampGranularity?: never;
  readonly referenceAudio?: never;
}
interface Immediate {
  /** @default "immediate" */
  readonly audioDelivery?: "immediate";
  /** Omission selects the native basic MP3 format at 32 kHz. */
  readonly output?: Output;
}
interface Paced {
  /** Requires WebSocket and a PCM-based format; never silently falls back to raw delivery. */
  readonly audioDelivery: "paced";
  readonly output: Pcm | Telephony;
}
interface Automatic extends Settings {
  /** Select a hosted model from language, not an invented model ID sent upstream. @default "auto" */
  readonly model?: "auto";
  /** TTS has no ASR language detection. @default "en" */
  readonly language?: "en" | NonEnglish;
}
interface English extends Settings {
  readonly model: "voiceai-tts-v1-latest" | "voiceai-tts-v1-2026-02-10";
  /** @default "en" */
  readonly language?: "en";
}
interface Lite extends Settings {
  /** Current hosted model guide includes Lite for TTS; the HTTP snapshot's enum is stale. */
  readonly model: "voiceai-tts-lite-v1-latest" | "voiceai-tts-lite-v1-2026-04-15";
  /** @default "en" */
  readonly language?: "en";
}
interface Multilingual extends Settings {
  readonly model: "voiceai-tts-multilingual-v1-latest" | "voiceai-tts-multilingual-v1-2026-02-10";
  readonly language: NonEnglish;
}
interface AutomaticImmediate extends Automatic, Immediate {}
interface AutomaticPaced extends Automatic, Paced {}
interface EnglishImmediate extends English, Immediate {}
interface EnglishPaced extends English, Paced {}
interface LiteImmediate extends Lite, Immediate {}
interface LitePaced extends Lite, Paced {}
interface MultilingualImmediate extends Multilingual, Immediate {}
interface MultilingualPaced extends Multilingual, Paced {}

interface Legacy {
  /** Original issue endpoint: POST /tts/v2/audio/speech. Not the current /api/v1 contract. */
  readonly apiVersion: "tts-v2";
  readonly text: string;
  readonly voice: string;
  /** No legacy sample-rate or PCM layout guarantee is published. */
  readonly output?: {
    readonly format: "mp3" | "wav" | "pcm";
    readonly sampleRateHz?: never;
    readonly bitRateBps?: never;
    readonly sampleEncoding?: never;
    readonly byteOrder?: never;
    readonly channelCount?: never;
    readonly constantBitRate?: never;
  };
  /** @minimum 0.8 @maximum 1.2 */
  readonly temperature?: number;
  /** @minimum 0.4 @maximum 0.9 */
  readonly topP?: number;
  readonly model?: never;
  readonly language?: never;
  readonly pronunciationDictionaries?: never;
  readonly audioDelivery?: never;
  readonly timestampGranularity?: never;
  readonly referenceAudio?: never;
}

export type TtsRequest = Legacy | AutomaticImmediate | AutomaticPaced | EnglishImmediate | EnglishPaced
  | LiteImmediate | LitePaced | MultilingualImmediate | MultilingualPaced;

export interface VoiceAiEnvelope {
  readonly correlation: "ordered";
  /** Native echoed context_id; audio for concurrent contexts must remain separate. */
  readonly correlationId: string;
  readonly audio: Uint8Array;
  /** Voice.ai does not document timestamp messages. */
  readonly timestamps: readonly never[];
}
