import type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/kugelaudio/index.ts";
import {
  createSpeech,
  getVoice,
  listModels,
  listVoices,
  type ClientOptions,
  type SynthesizeRequest,
} from "../../generated/clients/kugelaudio.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/kugelaudio/index.ts";
export type { Model, Voice, VoicePage } from "../../generated/clients/kugelaudio.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

export interface ClearEvent { readonly event: "clear" }

interface GenerationSettings {
  readonly voice_id: number | string;
  readonly cfg_scale?: number;
  readonly temperature?: number;
  readonly max_new_tokens?: number;
  readonly sample_rate?: number;
  readonly language?: string;
  readonly model_id: string;
  readonly normalize?: boolean;
  readonly project_id?: number;
  readonly dictionary_ids?: readonly number[];
  readonly speed?: number;
  readonly output_format?: string;
}

interface StreamConfig extends GenerationSettings {
  readonly word_timestamps?: boolean;
  readonly flush_timeout_ms?: number;
  readonly max_buffer_length?: number;
}

type ClientMessage =
  | StreamConfig
  | { readonly text: string }
  | { readonly flush: true }
  | { readonly cancel: true }
  | { readonly close_socket: true };

interface WordTimestamp {
  readonly word: string;
  readonly start_ms: number;
  readonly end_ms: number;
  readonly char_start?: number;
  readonly char_end?: number;
  readonly score?: number;
}

type ServerMessage =
  | { readonly audio: string; readonly chunk_id: number }
  | { readonly word_timestamps: readonly WordTimestamp[]; readonly chunk_id: number }
  | { readonly interrupted: true }
  | { readonly final: true }
  | { readonly session_closed: true }
  | { readonly generation_started: true }
  | { readonly chunk_complete: true }
  | { readonly settings_updated: true }
  | { readonly warning: string }
  | { readonly error: string; readonly error_code?: string; readonly code?: number };

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.kugelaudio?.apiKey
    ?? environment().SPEECHSWITCH_KUGELAUDIO_API_KEY
    ?? environment().KUGELAUDIO_API_KEY;
  if (!value) throw new TypeError("Missing auth.kugelaudio.apiKey configuration");
  return value;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  return {
    apiKey: apiKey(options),
    baseUrl: options.baseUrl ?? "https://api.kugelaudio.com",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function voiceId(value: string): string | number {
  return /^\d+$/.test(value) ? Number(value) : value;
}

function format(request: TtsRequest): { readonly output_format?: string; readonly sample_rate?: number } {
  if (request.output.format === "mulaw") return { output_format: "ulaw_8000" };
  if (request.output.format === "alaw") return { output_format: "alaw_8000" };
  return { sample_rate: request.output.sampleRateHz };
}

function settings(request: TtsRequest): GenerationSettings {
  return {
    voice_id: voiceId(request.voice),
    cfg_scale: request.guidanceScale,
    temperature: request.temperature,
    max_new_tokens: request.maxOutputTokens,
    ...format(request),
    language: request.language,
    model_id: request.model,
    normalize: request.textNormalization,
    project_id: request.dictionarySelection?.projectId,
    dictionary_ids: request.dictionarySelection?.dictionaryIds,
    speed: request.speed,
  };
}

function input(request: TtsRequest, text: string): SynthesizeRequest {
  return { text, ...settings(request) };
}

function config(request: TtsRequest, timestamps: boolean): StreamConfig {
  return {
    ...settings(request),
    word_timestamps: timestamps || undefined,
    flush_timeout_ms: request.streamingBuffer?.maxDelayMs,
    max_buffer_length: request.streamingBuffer?.characterThreshold,
  };
}

function webSocketUrl(options: SynthesizeOptions, key: string): string {
  const url = new URL(options.webSocketUrl ?? "wss://api.kugelaudio.com/ws/tts/stream");
  url.searchParams.set("api_key", key);
  return url.href;
}

function nativeSocket(url: string): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (url: string) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url);
}

function encodeMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeMessage(data: unknown): ServerMessage {
  if (typeof data !== "string") throw new TypeError("KugelAudio returned a non-text WebSocket message");
  const value: unknown = JSON.parse(data);
  if (!isRecord(value)) throw new TypeError("KugelAudio returned an invalid WebSocket event");
  if (typeof value.audio === "string" && typeof value.chunk_id === "number") return value as ServerMessage;
  if (Array.isArray(value.word_timestamps) && typeof value.chunk_id === "number"
    && value.word_timestamps.every((timestamp) => isRecord(timestamp)
      && typeof timestamp.word === "string" && typeof timestamp.start_ms === "number"
      && typeof timestamp.end_ms === "number")) return value as ServerMessage;
  if (value.interrupted === true || value.final === true || value.session_closed === true
    || value.generation_started === true || value.chunk_complete === true
    || value.settings_updated === true) return value as ServerMessage;
  if (typeof value.warning === "string" || typeof value.error === "string") return value as ServerMessage;
  throw new TypeError("KugelAudio returned an unknown WebSocket event");
}

type StreamValue =
  | ClearEvent
  | SynthesisEnvelope<Timestamp<"word">>;

async function* streaming(
  request: TtsRequest,
  text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>,
  options: SynthesizeOptions,
  timestamps: boolean,
): AsyncIterableIterator<StreamValue> {
  const key = apiKey(options);
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket: options.webSocket ?? nativeSocket(webSocketUrl(options, key)),
    encode: encodeMessage,
    decode: decodeMessage,
  });
  let requestedClose = false;
  const sending = (async () => {
    connection.send(config(request, timestamps));
    for await (const value of text) {
      connection.send(typeof value === "string"
        ? { text: value }
        : value.command === "clear" ? { cancel: true } : { flush: true });
    }
    requestedClose = true;
    connection.send({ close_socket: true });
  })();
  try {
    for await (const message of connection.messages) {
      if ("audio" in message) yield {
        correlation: "ordered",
        correlationId: String(message.chunk_id),
        audio: decodeBase64(message.audio),
        timestamps: [],
      };
      else if ("word_timestamps" in message && timestamps) yield {
        correlation: "ordered",
        correlationId: String(message.chunk_id),
        timestamps: message.word_timestamps.map((timestamp) => ({
          kind: "word",
          value: timestamp.word,
          startTimeMs: timestamp.start_ms,
          endTimeMs: timestamp.end_ms,
          source: timestamp.char_start === undefined || timestamp.char_end === undefined
            ? undefined
            : { start: timestamp.char_start, end: timestamp.char_end },
        })),
      };
      else if ("interrupted" in message) yield { event: "clear" };
      else if ("error" in message) {
        throw new TypeError(`KugelAudio WebSocket error${message.error_code ? ` ${message.error_code}` : ""}: ${message.error}`);
      }
    }
    await sending;
    if (!requestedClose) throw new TypeError("KugelAudio WebSocket closed before input completed");
  } finally {
    connection.close();
  }
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`KugelAudio returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array | ClearEvent> {
  if (typeof request.text !== "string") {
    for await (const value of streaming(request, request.text, options, false)) {
      if ("event" in value) yield value;
      else if (value.audio !== undefined) yield value.audio;
    }
    return;
  }
  const response = await createSpeech(input(request, request.text), resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("KugelAudio returned no audio stream");
  yield* response.body;
}

function singleText(value: string): AsyncIterable<string> {
  return (async function* () { yield value; })();
}

export async function* synthesizeWithTimestamps(
  request: TtsRequestWithTimestamps,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word">> | ClearEvent> {
  const text = typeof request.text === "string" ? singleText(request.text) : request.text;
  yield* streaming(request, text, options, true);
}

export interface VoiceOptions extends SynthesizeOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export function voices(options: VoiceOptions = {}) {
  return listVoices({ limit: options.limit, offset: options.offset }, resolve(options));
}

export function voice(voiceId: string, options: SynthesizeOptions = {}) {
  return getVoice(voiceId, resolve(options));
}

export function models(options: SynthesizeOptions = {}) {
  return listModels(resolve(options));
}
