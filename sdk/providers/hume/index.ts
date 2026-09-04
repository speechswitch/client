import type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/hume/index.ts";
import {
  createVoice as createVoiceRequest,
  decodeTtsOutput,
  deleteVoice as deleteVoiceRequest,
  encodeStreamInputMessage,
  listVoices,
  parseTtsOutput,
  synthesizeFileStreaming,
  synthesizeJsonStreaming,
  type ClientOptions,
  type PostedTts,
  type PostedUtterance,
  type StreamInputMessage,
  type TtsOutput,
  type VoiceProvider,
} from "../../generated/clients/hume.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { jsonLines } from "../../runtime/json-lines.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/hume/index.ts";
export type { Voice, VoicePage } from "../../generated/clients/hume.ts";

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
  const value = options.auth?.hume?.apiKey
    ?? environment().SPEECHSWITCH_HUME_API_KEY
    ?? environment().HUME_API_KEY;
  if (!value) throw new TypeError("Missing auth.hume.apiKey configuration");
  return value;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  return {
    apiKey: apiKey(options),
    baseUrl: options.baseUrl ?? "https://api.hume.ai",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function voiceProvider(source: "catalog" | "custom" | undefined): VoiceProvider {
  return source === "catalog" ? "HUME_AI" : "CUSTOM_VOICE";
}

function voice(request: TtsRequest): PostedUtterance["voice"] {
  return request.voice === undefined
    ? undefined
    : { id: request.voice, provider: voiceProvider(request.voiceSource) };
}

function instantMode(request: TtsRequest): boolean {
  return request.voice !== undefined && request.latencyOptimization !== "none";
}

function input(request: TtsRequest, text: string, timestamps: boolean): PostedTts {
  return {
    context: request.continuityId === undefined ? undefined : { generation_id: request.continuityId },
    format: { type: request.output.format },
    include_timestamp_types: timestamps ? ["word", "phoneme"] : undefined,
    num_generations: 1,
    split_utterances: false,
    strip_headers: true,
    temperature: request.temperature,
    utterances: [{
      text,
      description: request.deliveryInstructions,
      speed: request.speed,
      trailing_silence: request.trailingSilenceSeconds,
      voice: voice(request),
    }],
    version: request.model === "octave-2" ? "2" : "1",
    instant_mode: instantMode(request),
  };
}

function websocketUrl(request: TtsRequest, options: SynthesizeOptions, timestamps: boolean): URL {
  const url = new URL(options.webSocketUrl ?? "wss://api.hume.ai/v0/tts/stream/input");
  url.searchParams.set("api_key", apiKey(options));
  url.searchParams.set("format_type", request.output.format);
  url.searchParams.set("instant_mode", String(instantMode(request)));
  url.searchParams.set("no_binary", "true");
  url.searchParams.set("strip_headers", "true");
  url.searchParams.set("version", request.model === "octave-2" ? "2" : "1");
  if (request.continuityId !== undefined) url.searchParams.set("context_generation_id", request.continuityId);
  if (request.temperature !== undefined) url.searchParams.set("temperature", String(request.temperature));
  if (timestamps) {
    url.searchParams.append("include_timestamp_types", "word");
    url.searchParams.append("include_timestamp_types", "phoneme");
  }
  return url;
}

function nativeSocket(url: URL): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (url: string) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url.href);
}

function message(request: TtsRequest, text: string): StreamInputMessage {
  return {
    text,
    description: request.deliveryInstructions,
    speed: request.speed,
    trailing_silence: request.trailingSilenceSeconds,
    voice: voice(request),
  };
}

async function* websocket(
  request: TtsRequest,
  text: AsyncIterable<string | { readonly command: "flush" }>,
  options: SynthesizeOptions,
  timestamps: boolean,
): AsyncIterableIterator<TtsOutput> {
  const url = websocketUrl(request, options, timestamps);
  const connection = await connectWebSocket<StreamInputMessage, TtsOutput>({
    socket: options.webSocket ?? nativeSocket(url),
    encode: encodeStreamInputMessage,
    decode: decodeTtsOutput,
  });
  const sending = (async () => {
    for await (const value of text) {
      connection.send(typeof value === "string" ? message(request, value) : { flush: true });
    }
    connection.send({ close: true });
  })();
  try {
    for await (const value of connection.messages) yield value;
    await sending;
  } finally {
    connection.close();
  }
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Hume returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function envelope(value: TtsOutput): SynthesisEnvelope<Timestamp<"word" | "phoneme">> {
  if (value.type === "audio") return {
    correlation: "timeline",
    correlationId: value.snippet_id,
    audio: decodeBase64(value.audio),
    timestamps: [],
  };
  return {
    correlation: "timeline",
    correlationId: value.snippet_id,
    timestamps: [{
      kind: value.timestamp.type,
      value: value.timestamp.text,
      startTimeMs: value.timestamp.time.begin,
      endTimeMs: value.timestamp.time.end,
    }],
  };
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text !== "string") {
    for await (const value of websocket(request, request.text, options, false)) {
      if (value.type === "audio") yield decodeBase64(value.audio);
    }
    return;
  }
  const response = await synthesizeFileStreaming(input(request, request.text, false), resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Hume returned no audio stream");
  yield* response.body;
}

export async function* synthesizeWithTimestamps(
  request: TtsRequestWithTimestamps,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word" | "phoneme">>> {
  if (typeof request.text !== "string") {
    for await (const value of websocket(request, request.text, options, true)) yield envelope(value);
    return;
  }
  const response = await synthesizeJsonStreaming(input(request, request.text, true), resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Hume returned no JSON event stream");
  for await (const value of jsonLines(response.body)) yield envelope(parseTtsOutput(value));
}

export interface VoiceOptions extends SynthesizeOptions {
  readonly voiceSource: "catalog" | "custom";
  readonly pageNumber?: number;
  readonly pageSize?: number;
  readonly ascendingOrder?: boolean;
  readonly filterTags?: readonly string[];
}

export function voices(options: VoiceOptions) {
  return listVoices({
    provider: voiceProvider(options.voiceSource),
    pageNumber: options.pageNumber,
    pageSize: options.pageSize,
    ascendingOrder: options.ascendingOrder,
    filterTags: options.filterTags,
  }, resolve(options));
}

export function createVoice(generationId: string, name: string, options: SynthesizeOptions = {}) {
  return createVoiceRequest({ generation_id: generationId, name }, resolve(options));
}

export function deleteVoice(name: string, options: SynthesizeOptions = {}) {
  return deleteVoiceRequest(name, resolve(options));
}
