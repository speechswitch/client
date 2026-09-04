import type { TtsRequest } from "../../../schemas/providers/respeecher/index.ts";
import {
  bytes,
  sse,
  voices as listVoices,
  webSocketPath,
  webSocketServers,
  type ClientMessage,
  type ClientOptions,
  type SamplingParams,
  type ServerMessage,
  type SseEvent,
  type StreamingEncoding,
} from "../../generated/clients/respeecher.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { jsonLines } from "../../runtime/json-lines.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest } from "../../../schemas/providers/respeecher/index.ts";
export type { Voice } from "../../generated/clients/respeecher.ts";

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
  const value = options.auth?.respeecher?.apiKey
    ?? environment().SPEECHSWITCH_RESPEECHER_API_KEY
    ?? environment().RESPEECHER_API_KEY;
  if (!value) throw new TypeError("Missing auth.respeecher.apiKey configuration");
  return value;
}

function resolve(language: "en" | "uk", options: SynthesizeOptions): ClientOptions {
  return {
    apiKey: apiKey(options),
    language,
    fetch: options.fetch ?? globalThis.fetch,
    baseUrl: options.baseUrl,
    signal: options.signal,
  };
}

function sampling(request: TtsRequest | StreamingTtsRequest): SamplingParams | undefined {
  const value: SamplingParams = {
    seed: request.randomSeed,
    temperature: request.temperature,
    top_k: request.topTokenCount,
    top_p: request.topProbabilityMass,
    min_p: request.minimumTokenProbability,
    presence_penalty: request.presencePenalty,
    repetition_penalty: request.repetitionPenalty,
    frequency_penalty: request.frequencyPenalty,
  };
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

type StreamingTtsRequest = {
  readonly voice: string;
  readonly language: "en" | "uk";
  readonly output: Exclude<TtsRequest["output"], { readonly format: "wav" }>;
  readonly randomSeed?: number;
  readonly temperature?: number;
  readonly topTokenCount?: number;
  readonly topProbabilityMass?: number;
  readonly minimumTokenProbability?: number;
  readonly presencePenalty?: number;
  readonly repetitionPenalty?: number;
  readonly frequencyPenalty?: number;
};

function encoding(request: StreamingTtsRequest): StreamingEncoding {
  if (request.output.format === "mulaw") return "pcm_mulaw";
  return request.output.sampleEncoding === "float_32" ? "pcm_f32le" : "pcm_s16le";
}

function streamRequest(request: StreamingTtsRequest, transcript: string) {
  return {
    transcript,
    voice: { id: request.voice, sampling_params: sampling(request) },
    output_format: { sample_rate: request.output.sampleRateHz, encoding: encoding(request) },
  } as const;
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Respeecher returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function message(value: unknown): ServerMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Respeecher returned an invalid WebSocket message");
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "chunk" && typeof candidate.data === "string" && typeof candidate.context_id === "string") return value as ServerMessage;
  if (candidate.type === "done" && typeof candidate.context_id === "string") return value as ServerMessage;
  if (candidate.type === "error" && typeof candidate.error === "string" && typeof candidate.status_code === "number") return value as ServerMessage;
  throw new TypeError("Respeecher returned an unknown WebSocket message");
}

function decodeMessage(data: unknown): ServerMessage {
  if (typeof data !== "string") throw new TypeError("Respeecher returned a non-text WebSocket message");
  const value: unknown = JSON.parse(data);
  return message(value);
}

function sseEvent(value: unknown): SseEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Respeecher returned an invalid JSONL message");
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "chunk" && typeof candidate.data === "string") return value as SseEvent;
  if (candidate.type === "error" && typeof candidate.error === "string" && typeof candidate.status_code === "number") return value as SseEvent;
  throw new TypeError("Respeecher returned an unknown JSONL message");
}

function socket(request: { readonly language: "en" | "uk" }, options: SynthesizeOptions, key: string): WebSocketLike {
  if (options.webSocket) return options.webSocket;
  const runtime = globalThis as typeof globalThis & { readonly Bun?: unknown };
  if (runtime.Bun === undefined) {
    throw new TypeError("Respeecher streaming requires an injected authenticated WebSocket in this runtime");
  }
  const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { readonly headers: Readonly<Record<string, string>> }) => WebSocketLike;
  const base = options.webSocketUrl ?? webSocketServers[request.language];
  return new Constructor(`${base.replace(/\/$/, "")}${webSocketPath}`, { headers: { "X-API-Key": key } });
}

async function* websocket(
  request: StreamingTtsRequest & {
    readonly text: AsyncIterable<string | { readonly command: "clear" }>;
    readonly continuityId?: string;
  },
  options: SynthesizeOptions,
): AsyncIterableIterator<Uint8Array> {
  const key = apiKey(options);
  let contextId = request.continuityId ?? crypto.randomUUID();
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket: socket(request, options, key), encode: JSON.stringify, decode: decodeMessage,
  });
  let finalContext = contextId;
  const sending = (async () => {
    let pending: string | undefined;
    for await (const item of request.text) {
      if (typeof item === "string") {
        if (pending !== undefined) connection.send({ ...streamRequest(request, pending), context_id: contextId, continue: true });
        pending = item;
      } else {
        pending = undefined;
        connection.send({ context_id: contextId, cancel: true });
        contextId = crypto.randomUUID();
      }
    }
    if (pending === undefined) throw new TypeError("Respeecher incremental input ended without final text");
    finalContext = contextId;
    connection.send({ ...streamRequest(request, pending), context_id: contextId, continue: false });
  })();
  try {
    for await (const message of connection.messages) {
      if (message.context_id !== undefined && message.context_id !== contextId) continue;
      if (message.type === "error") throw new TypeError(`Respeecher returned ${message.status_code}: ${message.error}`);
      if (message.type === "chunk") yield decodeBase64(message.data);
      else if (message.context_id === finalContext) break;
    }
    await sending;
  } finally {
    connection.close();
  }
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const text = request.text;
  if (typeof text !== "string") {
    if (request.output.format === "wav") throw new TypeError("Respeecher cannot stream WAV input");
    yield* websocket({ ...request, text, output: request.output }, options);
    return;
  }
  const client = resolve(request.language, options);
  if (request.output.format === "wav") {
    const response = await bytes({
      transcript: text,
      voice: { id: request.voice, sampling_params: sampling(request) },
      output_format: { sample_rate: request.output.sampleRateHz },
    }, client);
    if (!response.ok) throw await responseError(response);
    if (!response.body) throw new TypeError("Respeecher returned no audio stream");
    yield* response.body;
    return;
  }
  const streamingRequest = { ...request, text, output: request.output };
  const response = await sse(streamRequest(streamingRequest, text), client);
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Respeecher returned no JSONL stream");
  for await (const value of jsonLines(response.body)) {
    const event = sseEvent(value);
    if (event.type === "chunk") yield decodeBase64(event.data);
    else if (event.type === "error") throw new TypeError(`Respeecher returned ${event.status_code}: ${event.error}`);
  }
}

export interface VoiceOptions extends SynthesizeOptions { readonly language: "en" | "uk" }

export function voices(options: VoiceOptions) {
  return listVoices(resolve(options.language, options));
}
