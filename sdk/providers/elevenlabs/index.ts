import type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/elevenlabs/index.ts";
import {
  createSpeech,
  createSpeechWithTimestamps,
  decodeMessage,
  encodeMessage,
  getVoice,
  listVoices,
  streamSpeech,
  streamSpeechWithTimestamps,
  type Alignment,
  type ClientMessage,
  type ClientOptions,
  type OutputFormat,
  type RealtimeAlignment,
  type ServerMessage,
  type SpeechInput,
} from "../../generated/clients/elevenlabs.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/elevenlabs/index.ts";
export { getVoice, listVoices } from "../../generated/clients/elevenlabs.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

const modelIds = {
  "eleven-v3": "eleven_v3",
  "flash-v2": "eleven_flash_v2",
  "flash-v2.5": "eleven_flash_v2_5",
  "multilingual-v2": "eleven_multilingual_v2",
} as const;

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  const apiKey = options.auth?.elevenlabs?.apiKey
    ?? environment().SPEECHSWITCH_ELEVENLABS_API_KEY
    ?? environment().ELEVENLABS_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.elevenlabs.apiKey configuration");
  return {
    apiKey,
    baseUrl: options.baseUrl ?? "https://api.elevenlabs.io",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function outputFormat(request: TtsRequest): OutputFormat {
  const { output } = request;
  if (output.format === "mulaw") return "ulaw_8000";
  if (output.format === "alaw") return "alaw_8000";
  if (output.format === "pcm" || output.format === "wav") return `${output.format}_${output.sampleRateHz}`;
  const codec = output.format === "ogg_opus" ? "opus" : "mp3";
  if (output.bitRateBps === undefined) throw new TypeError(`ElevenLabs ${codec} output requires a bit rate`);
  return `${codec}_${output.sampleRateHz}_${output.bitRateBps / 1000}` as OutputFormat;
}

function speechInput(request: TtsRequest, text: string): SpeechInput {
  const tuning = request.voiceTuning;
  return {
    text,
    model_id: modelIds[request.model],
    language_code: request.language,
    voice_settings: tuning || request.speed !== undefined ? {
      stability: tuning?.stability,
      similarity_boost: tuning?.similarity,
      style: tuning?.style,
      use_speaker_boost: tuning?.speakerBoost,
      speed: request.speed,
    } : undefined,
    apply_text_normalization: request.textNormalization === undefined
      ? undefined
      : request.textNormalization ? "on" : "off",
  };
}

function latency(request: TtsRequest): 0 | 2 | 4 | undefined {
  return request.latencyOptimization === undefined
    ? undefined
    : ({ none: 0, moderate: 2, aggressive: 4 } as const)[request.latencyOptimization];
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`ElevenLabs returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function timestampValues(values: Alignment | RealtimeAlignment | null | undefined): Timestamp<"character">[] {
  if (!values) return [];
  const characters = "characters" in values ? values.characters : values.chars;
  const starts = "character_start_times_seconds" in values
    ? values.character_start_times_seconds.map((value) => value * 1000)
    : values.charStartTimesMs;
  const ends = "character_end_times_seconds" in values
    ? values.character_end_times_seconds.map((value) => value * 1000)
    : values.charDurationsMs && starts?.map((start, index) => start + values.charDurationsMs![index]!);
  if (!characters || !starts || !ends) throw new TypeError("ElevenLabs returned incomplete character alignment");
  if (characters.length !== starts.length || characters.length !== ends.length) {
    throw new TypeError("ElevenLabs returned mismatched character alignment arrays");
  }
  return characters.map((value, index) => ({
    kind: "character",
    value,
    startTimeMs: starts[index]!,
    endTimeMs: ends[index]!,
  }));
}

function webSocketUrl(request: TtsRequest, options: SynthesizeOptions): URL {
  const base = options.webSocketUrl ?? "wss://api.elevenlabs.io";
  const url = new URL(`/v1/text-to-speech/${encodeURIComponent(request.voice)}/stream-input`, base);
  url.searchParams.set("model_id", modelIds[request.model]);
  url.searchParams.set("output_format", outputFormat(request));
  if (request.language) url.searchParams.set("language_code", request.language);
  if (request.textNormalization !== undefined) {
    url.searchParams.set("apply_text_normalization", request.textNormalization ? "on" : "off");
  }
  if (request.latencyOptimization === "aggressive") url.searchParams.set("auto_mode", "true");
  return url;
}

function nativeSocket(url: URL, apiKey: string): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (
    url: string,
    options: { readonly headers: Readonly<Record<string, string>> },
  ) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url.href, { headers: { "xi-api-key": apiKey } });
}

async function* streaming(
  request: TtsRequest,
  text: AsyncIterable<string | { readonly command: "flush" }>,
  options: SynthesizeOptions,
  timestamps: boolean,
): AsyncIterableIterator<Uint8Array | SynthesisEnvelope<Timestamp<"character">>> {
  const client = resolve(options);
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket: options.webSocket ?? nativeSocket(webSocketUrl(request, options), client.apiKey),
    encode: encodeMessage,
    decode: decodeMessage,
  });
  const tuning = request.voiceTuning;
  connection.send({
    text: " ",
    voice_settings: tuning || request.speed !== undefined ? {
      stability: tuning?.stability,
      similarity_boost: tuning?.similarity,
      style: tuning?.style,
      use_speaker_boost: tuning?.speakerBoost,
      speed: request.speed,
    } : undefined,
  });
  const sending = (async () => {
    for await (const value of text) {
      if (typeof value === "string") {
        if (value) connection.send({ text: value.endsWith(" ") ? value : `${value} ` });
      } else {
        connection.send({ text: " ", flush: true });
      }
    }
    connection.send({ text: "" });
  })();
  try {
    for await (const message of connection.messages) {
      if ("audio" in message) {
        const audio = decodeBase64(message.audio);
        if (timestamps) {
          yield {
            correlation: "chunk",
            audio,
            timestamps: timestampValues(message.alignment ?? message.normalizedAlignment),
          };
        } else {
          yield audio;
        }
      } else {
        await sending;
        return;
      }
    }
    await sending;
    throw new TypeError("ElevenLabs WebSocket closed before isFinal");
  } finally {
    connection.close();
  }
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text !== "string") {
    for await (const value of streaming(request, request.text, options, false)) {
      if (value instanceof Uint8Array) yield value;
    }
    return;
  }
  const synthesizeSpeech = request.latencyOptimization === "moderate" || request.latencyOptimization === "aggressive"
    ? streamSpeech
    : createSpeech;
  const response = await synthesizeSpeech(
    request.voice,
    speechInput(request, request.text),
    outputFormat(request),
    latency(request),
    resolve(options),
  );
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("ElevenLabs returned no audio stream");
  yield* response.body;
}

export async function* synthesizeWithTimestamps(
  request: TtsRequestWithTimestamps,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"character">>> {
  if (typeof request.text !== "string") {
    for await (const value of streaming(request, request.text, options, true)) {
      if (!(value instanceof Uint8Array)) yield value;
    }
    return;
  }
  const synthesizeSpeech = request.latencyOptimization === "moderate" || request.latencyOptimization === "aggressive"
    ? streamSpeechWithTimestamps
    : createSpeechWithTimestamps;
  const response = await synthesizeSpeech(
    request.voice,
    speechInput(request, request.text),
    outputFormat(request),
    latency(request),
    resolve(options),
  );
  if (!response.ok) throw await responseError(response);
  const value = await response.json() as {
    readonly audio_base64: string;
    readonly alignment?: Alignment | null;
    readonly normalized_alignment?: Alignment | null;
  };
  yield {
    correlation: "chunk",
    audio: decodeBase64(value.audio_base64),
    timestamps: timestampValues(value.alignment ?? value.normalized_alignment),
  };
}

export interface VoiceOptions extends SynthesizeOptions {}

export function voices(options: VoiceOptions = {}) { return listVoices(resolve(options)); }
export function voice(voiceId: string, options: VoiceOptions = {}) { return getVoice(voiceId, resolve(options)); }
