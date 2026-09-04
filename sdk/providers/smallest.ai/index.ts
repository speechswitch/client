import type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/smallest.ai/index.ts";
import {
  defaultBaseUrl,
  defaultWebSocketUrl,
  synthesizeSse,
  synthesizeSync,
  type Language,
  type Model,
  type OutputFormat,
  type SseOutput,
  type TtsInput,
  type WebSocketInput,
  type WebSocketOutput,
} from "../../generated/clients/smallest.ai.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { serverSentEvents } from "../../runtime/sse.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/smallest.ai/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  /** WebSocket idle timeout requested from Smallest.ai, in seconds. */
  readonly idleTimeoutSeconds?: number;
  readonly signal?: AbortSignal;
}

function environment(): Record<string, string | undefined> { return typeof process === "undefined" ? {} : process.env; }
function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.["smallest.ai"]?.apiKey ?? environment().SPEECHSWITCH_SMALLEST_AI_API_KEY ?? environment().SMALLEST_API_KEY;
  if (!value) throw new TypeError("Missing auth['smallest.ai'].apiKey configuration");
  return value;
}
const wireModel = { "lightning-v3.1": "lightning_v3.1", "lightning-v3.1-pro": "lightning_v3.1_pro" } as const;
const wireFormat = { mp3: "mp3", pcm: "pcm", wav: "wav", mulaw: "ulaw", alaw: "alaw" } as const;

function input(request: TtsRequest | TtsRequestWithTimestamps, text: string, timestamps = false): TtsInput {
  return {
    text,
    voice_id: request.voice,
    model: wireModel[request.model] as Model,
    sample_rate: request.output.sampleRateHz,
    speed: request.speed,
    language: request.language as Language | undefined,
    number_pronunciation_language: request.numberReadingLanguage as Language | undefined,
    math_notation: request.interpretMath,
    output_format: wireFormat[request.output.format] as OutputFormat,
    pronunciation_dicts: request.dictionarySelection?.dictionaryIds,
    word_timestamps: timestamps || undefined,
  };
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Smallest.ai returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}
function sseMessage(data: string): SseOutput {
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Smallest.ai returned an invalid SSE message");
  const candidate = value as Record<string, unknown>;
  if (candidate.done === false && candidate.status === "206" && typeof candidate.audio === "string") return value as SseOutput;
  if (candidate.done === true && candidate.status === "200") return value as SseOutput;
  throw new TypeError("Smallest.ai returned an unknown SSE message");
}

async function* staticAudio(request: Extract<TtsRequest, { readonly text: string }>, options: SynthesizeOptions): AsyncIterableIterator<Uint8Array> {
  const client = { apiKey: apiKey(options), fetch: options.fetch ?? globalThis.fetch, baseUrl: options.baseUrl ?? defaultBaseUrl, signal: options.signal };
  if (request.latencyOptimization === "none") {
    const response = await synthesizeSync(input(request, request.text), client);
    if (!response.ok) throw await responseError(response);
    if (!response.body) throw new TypeError("Smallest.ai returned no audio stream");
    yield* response.body;
    return;
  }
  const response = await synthesizeSse(input(request, request.text), client);
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Smallest.ai returned no SSE stream");
  for await (const data of serverSentEvents(response.body)) {
    const message = sseMessage(data);
    if (!message.done) yield decodeBase64(message.audio);
  }
}

function webSocketUrl(options: SynthesizeOptions): string {
  const url = new URL(options.webSocketUrl ?? defaultWebSocketUrl);
  if (options.idleTimeoutSeconds !== undefined) {
    if (!Number.isInteger(options.idleTimeoutSeconds) || options.idleTimeoutSeconds <= 0) throw new TypeError("Smallest.ai idleTimeoutSeconds must be a positive integer");
    url.searchParams.set("timeout", String(options.idleTimeoutSeconds));
  }
  return url.href;
}
function socket(options: SynthesizeOptions, key: string): WebSocketLike {
  if (options.webSocket) return options.webSocket;
  if ((globalThis as typeof globalThis & { readonly Bun?: unknown }).Bun === undefined) throw new TypeError("Smallest.ai streaming requires an injected authenticated WebSocket in this runtime");
  const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { readonly headers: Readonly<Record<string, string>> }) => WebSocketLike;
  return new Constructor(webSocketUrl(options), { headers: { authorization: `Bearer ${key}` } });
}
function webSocketMessage(data: unknown): WebSocketOutput {
  if (typeof data !== "string") throw new TypeError("Smallest.ai returned a non-text WebSocket message");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Smallest.ai returned an invalid WebSocket message");
  const candidate = value as Record<string, unknown>;
  const payload = candidate.data as Record<string, unknown> | undefined;
  if (candidate.status === "chunk" && typeof payload?.audio === "string") return value as WebSocketOutput;
  if (candidate.status === "word_timestamp" && typeof payload?.word === "string" && typeof payload.start === "number" && typeof payload.end === "number" && typeof payload.id === "number") return value as WebSocketOutput;
  if (candidate.status === "complete") return value as WebSocketOutput;
  if (candidate.status === "error") return value as WebSocketOutput;
  throw new TypeError("Smallest.ai returned an unknown WebSocket message");
}
function controls(request: TtsRequest | TtsRequestWithTimestamps, timestamps: boolean): WebSocketInput {
  return {
    voice_id: request.voice,
    model: wireModel[request.model],
    sample_rate: request.output.sampleRateHz,
    speed: request.speed,
    language: request.language as Language | undefined,
    number_pronunciation_language: request.numberReadingLanguage as Language | undefined,
    math_notation: request.interpretMath,
    complete_backoff_ms: request.streamingBuffer?.completionDelayMs,
    context_id: request.continuityId,
    max_buffer_delay_ms: request.continuityId ? request.streamingBuffer?.maxDelayMs : undefined,
    max_buffer_flush_ms: request.continuityId ? undefined : request.streamingBuffer?.maxDelayMs,
    word_timestamps: timestamps || undefined,
  };
}

async function* webSocketEvents(request: TtsRequest | TtsRequestWithTimestamps, options: SynthesizeOptions, timestamps: boolean): AsyncIterableIterator<WebSocketOutput> {
  if (typeof request.text === "string") throw new TypeError("Smallest.ai WebSocket input must be incremental");
  const connection = await connectWebSocket<WebSocketInput, WebSocketOutput>({ socket: socket(options, apiKey(options)), encode: JSON.stringify, decode: webSocketMessage });
  const common = controls(request, timestamps);
  const finalRequestId = `speechswitch-final-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sending = (async () => {
    for await (const value of request.text) {
      if (typeof value === "string") connection.send({ ...common, text: value, continue: true });
      else if (request.continuityId) connection.send({ context_id: request.continuityId, context_close: true });
      else connection.send({ ...common, text: "", flush: true });
    }
    if (request.continuityId) connection.send({ context_id: request.continuityId, context_close: true, request_id: finalRequestId });
    else connection.send({ ...common, text: "", flush: true, request_id: finalRequestId });
  })();
  try {
    for await (const message of connection.messages) {
      if (message.status === "error") throw new TypeError(`Smallest.ai returned an error: ${message.message ?? message.error?.message ?? message.error?.code ?? "unknown error"}`);
      yield message;
      if (message.status === "complete" && (!request.continuityId || message.external_request_id === finalRequestId)) break;
    }
    await sending;
  } finally { connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text === "string") { yield* staticAudio(request as Extract<TtsRequest, { readonly text: string }>, options); return; }
  for await (const message of webSocketEvents(request, options, false)) if (message.status === "chunk") yield decodeBase64(message.data.audio);
}

export async function* synthesizeWithTimestamps(request: TtsRequestWithTimestamps, options: SynthesizeOptions = {}): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word">>> {
  for await (const message of webSocketEvents(request, options, true)) {
    if (message.status === "chunk") yield { correlation: "timeline", audio: decodeBase64(message.data.audio), timestamps: [] };
    else if (message.status === "word_timestamp") yield { correlation: "timeline", timestamps: [{ kind: "word", value: message.data.word, startTimeMs: message.data.start * 1000, endTimeMs: message.data.end * 1000 }] };
  }
}
