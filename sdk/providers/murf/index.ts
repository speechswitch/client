import type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/murf/index.ts";
import {
  defaultWebSocketUrl,
  generateSpeech,
  listVoices,
  streamSpeech,
  type ClientOptions,
  type SpeechSettings,
  type WebSocketClientMessage,
  type WebSocketServerMessage,
} from "../../generated/clients/murf.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/murf/index.ts";
export type { Voice } from "../../generated/clients/murf.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.murf?.apiKey
    ?? environment().SPEECHSWITCH_MURF_API_KEY
    ?? environment().MURF_API_KEY;
  if (!value) throw new TypeError("Missing auth.murf.apiKey configuration");
  return value;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  return {
    apiKey: apiKey(options),
    baseUrl: options.baseUrl ?? "https://global.api.murf.ai",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function format(value: TtsRequest["output"]["format"]): SpeechSettings["format"] {
  if (value === "alaw") return "ALAW";
  if (value === "mulaw") return "ULAW";
  return value.toUpperCase() as SpeechSettings["format"];
}

function rate(value: number | undefined): number | undefined {
  return value === undefined ? undefined : (value - 1) * 100;
}

const variation = { stable: 0, balanced: 1, creative: 5 } as const;

function settings(request: TtsRequest, text: string): SpeechSettings {
  return {
    channelType: "MONO",
    format: format(request.output.format),
    locale: request.language,
    rate: rate(request.speed),
    sampleRate: request.output.sampleRateHz,
    style: request.voiceVariant,
    variation: request.deliveryVariation === undefined ? undefined : variation[request.deliveryVariation],
    text,
    voiceId: request.voice,
  };
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Murf returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function nativeSocket(url: string): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (url: string) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url);
}

function socketUrl(request: TtsRequest, options: SynthesizeOptions, key: string): string {
  const url = new URL(options.webSocketUrl ?? defaultWebSocketUrl);
  url.searchParams.set("api_key", key);
  url.searchParams.set("model", request.model);
  url.searchParams.set("sample_rate", String(request.output.sampleRateHz));
  url.searchParams.set("channel_type", "MONO");
  url.searchParams.set("format", format(request.output.format));
  return url.href;
}

function decodeMessage(data: unknown): WebSocketServerMessage {
  if (typeof data !== "string") throw new TypeError("Murf returned a non-text WebSocket message");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Murf returned an invalid WebSocket message");
  }
  const message = value as Record<string, unknown>;
  if (typeof message.audio === "string" || typeof message.final === "boolean") {
    return value as WebSocketServerMessage;
  }
  throw new TypeError("Murf returned an unknown WebSocket message");
}

async function* websocket(
  request: TtsRequest,
  text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>,
  options: SynthesizeOptions,
): AsyncIterableIterator<Uint8Array> {
  const key = apiKey(options);
  const contextId = request.continuityId ?? crypto.randomUUID();
  const connection = await connectWebSocket<WebSocketClientMessage, WebSocketServerMessage>({
    socket: options.webSocket ?? nativeSocket(socketUrl(request, options, key)),
    encode: JSON.stringify,
    decode: decodeMessage,
  });
  const sending = (async () => {
    if (request.streamingBuffer) connection.send({
      min_buffer_size: request.streamingBuffer.characterThreshold,
      max_buffer_delay_in_ms: request.streamingBuffer.maxDelayMs,
    });
    connection.send({
      context_id: contextId,
      voice_config: {
        voice_id: request.voice,
        style: request.voiceVariant,
        rate: rate(request.speed),
        variation: request.deliveryVariation === undefined ? undefined : variation[request.deliveryVariation],
        locale: request.language,
      },
    });
    let ended = false;
    for await (const value of text) {
      if (typeof value === "string") connection.send({ text: value, context_id: contextId });
      else if (value.command === "clear") connection.send({ clear: true, context_id: contextId });
      else {
        connection.send({ text: "", context_id: contextId, end: true });
        ended = true;
      }
    }
    if (!ended) connection.send({ text: "", context_id: contextId, end: true });
  })();
  let completed = false;
  try {
    for await (const message of connection.messages) {
      if (message.context_id != null && message.context_id !== contextId) continue;
      if ("audio" in message) yield decodeBase64(message.audio);
      else if (message.final) {
        completed = true;
        break;
      }
    }
    await sending;
    if (!completed) throw new TypeError("Murf WebSocket closed before the final event");
  } finally {
    connection.close();
  }
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text !== "string") {
    yield* websocket(request, request.text, options);
    return;
  }
  const response = await streamSpeech({ ...settings(request, request.text), model: request.model }, resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Murf returned no audio stream");
  yield* response.body;
}

export async function* synthesizeWithTimestamps(
  request: TtsRequestWithTimestamps,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word">>> {
  const result = await generateSpeech({
    ...settings(request, request.text),
    modelVersion: "GEN2",
    wordDurationsAsOriginalText: true,
  }, resolve(options));
  const timestamps = result.wordDurations.map((word): Timestamp<"word"> => {
    if (typeof word.word !== "string" || typeof word.startMs !== "number" || typeof word.endMs !== "number") {
      throw new TypeError("Murf returned an invalid word duration");
    }
    return { kind: "word", value: word.word, startTimeMs: word.startMs, endTimeMs: word.endMs };
  });
  yield {
    correlation: "timeline",
    timestamps,
  };
  const response = await (options.fetch ?? globalThis.fetch)(result.audioFile, { signal: options.signal });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Murf returned no timestamped audio stream");
  for await (const audio of response.body) yield { correlation: "timeline", audio, timestamps: [] };
}

export interface VoiceOptions extends SynthesizeOptions { readonly model?: "falcon-2" | "gen2" }

export function voices(options: VoiceOptions = {}) {
  return listVoices(options.model, resolve(options));
}
