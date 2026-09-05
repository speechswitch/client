import type { TtsRequest } from "../../../schemas/providers/cartesia/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { ClearEvent, FlushEvent } from "../../dispatch.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { serverSentEvents } from "../../runtime/sse.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest } from "../../../schemas/providers/cartesia/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
  /** Optional deadline for the whole operation, including input and network waits. */
  readonly timeoutMs?: number;
}

export class CartesiaError extends Error {
  readonly statusCode: number;
  readonly errorCode: string | null;
  readonly requestId: string | undefined;
  readonly docUrl: string | undefined;
  readonly contextId: string | undefined;
  constructor(payload: unknown, statusCode: number) {
    const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const title = typeof value.title === "string" ? value.title : "Request failed";
    const message = typeof value.message === "string" ? value.message : typeof payload === "string" ? payload : "Invalid error response";
    super(`Cartesia ${statusCode}: ${title}: ${message}`);
    this.name = "CartesiaError";
    this.statusCode = statusCode;
    this.errorCode = typeof value.error_code === "string" ? value.error_code : null;
    this.requestId = typeof value.request_id === "string" ? value.request_id : undefined;
    this.docUrl = typeof value.doc_url === "string" ? value.doc_url : undefined;
    this.contextId = typeof value.context_id === "string" ? value.context_id : undefined;
  }
}

// The public chunk schema omits flush_id, and its cancel/error descriptions
// disagree with the protocol guides. Keep this wire implementation authored.
const version = "2026-08-14";
interface Settings {
  readonly model_id: "sonic-3" | "sonic-3.5" | "sonic-3.6";
  readonly voice: string;
  readonly output_format:
    | { readonly container: "mp3"; readonly sample_rate: number; readonly bit_rate: number }
    | { readonly container: "raw" | "wav"; readonly sample_rate: number; readonly encoding: "pcm_s16le" | "pcm_f32le" | "pcm_mulaw" | "pcm_alaw" };
  readonly language: string | undefined;
  readonly locale: string | undefined;
  readonly accent: string | undefined;
  readonly normalization: string | undefined;
  readonly pronunciation_dict_id: string | undefined;
  readonly generation_config: { readonly volume?: number; readonly speed?: number; readonly emotion?: string };
}
interface StreamingSettings extends Settings {
  readonly max_buffer_delay_ms: number;
  readonly add_timestamps: boolean;
  readonly add_phoneme_timestamps: boolean;
  readonly use_normalized_timestamps: boolean;
}
interface Generation extends StreamingSettings {
  readonly transcript: string;
  readonly context_id: string;
  readonly continue: boolean;
  readonly flush: boolean;
}
type ClientMessage = Generation | { readonly context_id: string; readonly cancel: true };
interface PacketContext { readonly contextId: string | undefined; readonly inputGroupId: string | undefined }
interface Chunk extends PacketContext { readonly type: "chunk"; readonly data: string }
interface Timing extends PacketContext { readonly type: "timestamps" | "phoneme_timestamps"; readonly timestamps: readonly Timestamp<"word" | "phoneme">[] }
interface Done extends PacketContext { readonly type: "done" }
interface Flushed extends PacketContext { readonly type: "flush_done"; readonly inputGroupId: string }
interface Failure extends PacketContext { readonly type: "error"; readonly error: CartesiaError }
type Packet = Chunk | Timing | Done | Flushed | Failure;
type Output = Uint8Array | SynthesisEnvelope<Timestamp<"word" | "phoneme">> | ClearEvent | FlushEvent;

function settings(request: TtsRequest): Settings {
  if (request.speed !== undefined && (!Number.isFinite(request.speed) || request.speed < 0.6 || request.speed > 1.5)) throw new TypeError("Cartesia speed must be between 0.6 and 1.5");
  if (request.volumeScale !== undefined && (!Number.isFinite(request.volumeScale) || request.volumeScale < 0.5 || request.volumeScale > 2)) throw new TypeError("Cartesia volumeScale must be between 0.5 and 2");
  if (request.maxBufferDelayMs !== undefined && (!Number.isFinite(request.maxBufferDelayMs) || request.maxBufferDelayMs < 0 || request.maxBufferDelayMs > 5000)) throw new TypeError("Cartesia maxBufferDelayMs must be between 0 and 5000");
  const output = request.output;
  const encoding = output.format === "mulaw" || output.format === "alaw" ? output.format
    : output.format === "pcm" || output.format === "wav" ? output.sampleEncoding ?? "signed_integer_16" : "signed_integer_16";
  return {
    model_id: request.model,
    voice: request.voice,
    output_format: output.format === "mp3"
      ? { container: "mp3", sample_rate: output.sampleRateHz, bit_rate: output.bitRateBps }
      : { container: output.format === "wav" ? "wav" : "raw", sample_rate: output.sampleRateHz, encoding: ({ signed_integer_16: "pcm_s16le", float_32: "pcm_f32le", mulaw: "pcm_mulaw", alaw: "pcm_alaw" } as const)[encoding] },
    language: request.model === "sonic-3.6" ? undefined : request.language,
    locale: request.model === "sonic-3.6" ? request.language : undefined,
    accent: request.accent,
    normalization: typeof request.textNormalization === "boolean" ? request.textNormalization ? "auto" : "off" : request.textNormalization?.locale,
    pronunciation_dict_id: request.lexicon,
    generation_config: { volume: request.volumeScale, speed: request.speed, emotion: request.emotion },
  };
}

function decodeMessage(data: unknown, transport: "sse" | "websocket"): Packet {
  if (typeof data !== "string") throw new TypeError("Cartesia returned a non-text frame");
  const parsed: unknown = JSON.parse(data);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Cartesia returned an invalid frame");
  const value = parsed as Record<string, unknown>;
  if (typeof value.status_code !== "number" || !Number.isInteger(value.status_code)) throw new TypeError("Cartesia returned an invalid status_code");
  if (value.context_id !== undefined && value.context_id !== null && typeof value.context_id !== "string") throw new TypeError("Cartesia returned an invalid context ID");
  const contextId = typeof value.context_id === "string" ? value.context_id : undefined;
  if (value.flush_id !== undefined && (typeof value.flush_id !== "number" || !Number.isSafeInteger(value.flush_id) || value.flush_id < 0)) throw new TypeError("Cartesia returned an invalid flush ID");
  const inputGroupId = value.flush_id === undefined ? undefined : String(value.flush_id);
  const context = { contextId, inputGroupId };
  if (value.type === "error") return { ...context, type: "error", error: new CartesiaError(value, value.status_code) };
  if (transport === "websocket" && contextId === undefined) throw new TypeError("Cartesia WebSocket output lacks its context ID");
  if (typeof value.done !== "boolean") throw new TypeError("Cartesia returned an invalid completion flag");
  if (value.type === "done" && value.done) return { ...context, type: "done" };
  if (value.type === "flush_done" && transport === "websocket" && value.flush_done === true && inputGroupId !== undefined) return { ...context, inputGroupId, type: "flush_done" };
  if (value.type === "chunk" && typeof value.data === "string") return { ...context, type: "chunk", data: value.data };
  if (value.type === "timestamps" || value.type === "phoneme_timestamps") {
    const kind: "word" | "phoneme" = value.type === "timestamps" ? "word" : "phoneme";
    const raw = value[kind === "word" ? "word_timestamps" : "phoneme_timestamps"];
    if (raw === undefined && transport === "websocket") return { ...context, type: value.type, timestamps: [] };
    if (!raw || typeof raw !== "object") throw new TypeError("Cartesia returned incomplete timestamps");
    const timing = raw as Record<string, unknown>;
    const labels = timing[kind === "word" ? "words" : "phonemes"];
    const starts = timing.start;
    const ends = timing.end;
    if (!Array.isArray(labels) || !Array.isArray(starts) || !Array.isArray(ends) || labels.length !== starts.length || labels.length !== ends.length) throw new TypeError("Cartesia returned mismatched timestamp arrays");
    const timestamps = labels.map((label: unknown, index) => {
      const start: unknown = starts[index]; const end: unknown = ends[index];
      if (typeof label !== "string" || typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) throw new TypeError("Cartesia returned an invalid timestamp");
      return { kind, value: label, startTimeMs: start * 1000, endTimeMs: end * 1000 };
    });
    return { ...context, type: value.type, timestamps };
  }
  throw new TypeError(`Unknown Cartesia event: ${String(value.type)}`);
}

function output(packet: Packet, contextId: string, timed: boolean): Output | undefined {
  if (packet.type === "error") throw packet.error;
  if (packet.type === "done") return;
  if (packet.type === "flush_done") return { event: "flush", correlationId: contextId, inputGroupId: packet.inputGroupId };
  const correlation = { correlation: "timeline" as const, correlationId: contextId, ...(packet.inputGroupId === undefined ? {} : { inputGroupId: packet.inputGroupId }) };
  if (packet.type === "chunk") {
    const audio = decodeBase64(packet.data);
    return timed || packet.inputGroupId !== undefined ? { ...correlation, audio, timestamps: [] } : audio;
  }
  return { ...correlation, timestamps: packet.timestamps };
}

async function* websocket(text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>, wire: StreamingSettings, socket: WebSocketLike, signal: AbortSignal): AsyncIterableIterator<Output> {
  const connection = await connectWebSocket({ socket, signal, encode: (message: ClientMessage) => JSON.stringify(message), decode: data => decodeMessage(data, "websocket") });
  let source: AsyncIterator<string | { readonly command: "clear" } | { readonly command: "flush" }>;
  try { source = text[Symbol.asyncIterator](); } catch (error) { connection.close(); throw error; }
  let inputDone = false; let stopped = false;
  const stopInput = () => {
    if (inputDone || stopped) return;
    stopped = true;
    // An uncooperative next() must not block output cancellation.
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  let contextId = crypto.randomUUID();
  let used = false;
  const retired = new Set<string>();
  const generation = (transcript: string, continued: boolean, flush: boolean): Generation => ({
    ...wire, transcript, context_id: contextId, continue: continued, flush,
  });
  try {
    signal.throwIfAborted();
    const nextInput = () => Promise.resolve().then(() => { signal.throwIfAborted(); return source.next(); }).then(
      value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }),
    );
    const nextOutput = () => connection.messages.next().then(
      value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }),
    );
    let pendingInput = nextInput(); let pendingOutput = nextOutput();
    let preferInput = true;
    for (;;) {
      const event = await (inputDone ? pendingOutput : Promise.race(preferInput ? [pendingInput, pendingOutput] : [pendingOutput, pendingInput]));
      signal.throwIfAborted();
      preferInput = !preferInput;
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        if (event.value.done) {
          inputDone = true;
          if (!used) return;
          connection.send(generation("", false, false));
        } else {
          const value = event.value.value;
          if (typeof value === "string") {
            if (value.length) { connection.send(generation(value, true, false)); used = true; }
          } else if (value.command === "flush") {
            if (used) connection.send(generation("", true, true));
          } else if (value.command === "clear") {
            if (used) connection.send({ context_id: contextId, cancel: true });
            retired.add(contextId); contextId = crypto.randomUUID(); used = false;
            // This marks the local playback boundary, not a server cancel ACK.
            yield { event: "clear" };
          } else throw new TypeError("Unsupported Cartesia input command");
          pendingInput = nextInput();
        }
      } else {
        if (event.value.done) throw new TypeError("Cartesia WebSocket closed before context completion (idle connections expire after five minutes)");
        const packet = event.value.value;
        if (packet.contextId !== undefined && retired.has(packet.contextId)) { pendingOutput = nextOutput(); continue; }
        if (packet.contextId !== undefined && packet.contextId !== contextId) throw new TypeError("Cartesia returned output for an unexpected context");
        if (packet.type === "done") {
          if (inputDone) return;
          // A completed/expired context cannot accept more text. A later input
          // begins a new context with its own timestamp origin.
          retired.add(contextId); contextId = crypto.randomUUID(); used = false;
        } else {
          const value = output(packet, contextId, wire.add_timestamps || wire.add_phoneme_timestamps);
          if (value !== undefined) yield value;
        }
        pendingOutput = nextOutput();
      }
    }
  } finally {
    signal.removeEventListener("abort", stopInput); stopInput(); connection.close();
  }
}

interface HttpConfiguration { readonly credential: string; readonly baseUrl: string; readonly fetch: Fetch; readonly signal: AbortSignal }

async function responseError(response: Response): Promise<CartesiaError> {
  const text = await response.text(); let error: unknown = text;
  try { error = JSON.parse(text); } catch {}
  return new CartesiaError(error, response.status);
}

async function createAccessToken(config: HttpConfiguration): Promise<string> {
  const response = await config.fetch(new URL("/access-token", config.baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${config.credential}`, "cartesia-version": version, "content-type": "application/json" },
    body: JSON.stringify({ grants: { tts: true }, expires_in: 60 }),
    signal: config.signal,
  });
  if (!response.ok) throw await responseError(response);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("token" in body) || typeof body.token !== "string" || !body.token) throw new TypeError("Cartesia returned an invalid access token");
  return body.token;
}

async function* http(request: TtsRequest, text: string, wire: Settings, config: HttpConfiguration): AsyncIterableIterator<Output> {
  const timed = request.timestampGranularity !== undefined;
  const contextId = crypto.randomUUID();
  const response = await config.fetch(new URL(timed ? "/tts/sse" : "/tts/bytes", config.baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${config.credential}`, "cartesia-version": version, "content-type": "application/json" },
    body: JSON.stringify({ ...wire, transcript: text, ...(timed ? {
      context_id: contextId, add_timestamps: request.timestampGranularity?.includes("word") ?? false, add_phoneme_timestamps: request.timestampGranularity?.includes("phoneme") ?? false, use_normalized_timestamps: request.timestampText === "normalized",
    } : {}) }),
    signal: config.signal,
  });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Cartesia returned no audio stream");
  if (!timed) {
    for await (const chunk of response.body) { config.signal.throwIfAborted(); yield chunk; }
    config.signal.throwIfAborted(); return;
  }
  for await (const data of serverSentEvents(response.body)) {
    config.signal.throwIfAborted();
    const packet = decodeMessage(data, "sse");
    if (packet.contextId !== undefined && packet.contextId !== contextId) throw new TypeError("Cartesia SSE returned an unexpected context");
    if (packet.type === "done") return;
    const value = output(packet, contextId, true);
    if (value !== undefined) yield value;
  }
  throw new TypeError("Cartesia SSE ended before the done event");
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted();
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Cartesia timeoutMs must be an integer between 0 and 2147483647");
  if (timeoutMs === 0) throw new DOMException("Cartesia synthesis deadline expired", "TimeoutError");
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.cartesia?.apiKey ?? environment.SPEECHSWITCH_CARTESIA_API_KEY ?? environment.CARTESIA_API_KEY;
  const accessToken = options.auth?.cartesia?.accessToken ?? environment.SPEECHSWITCH_CARTESIA_ACCESS_TOKEN ?? environment.CARTESIA_ACCESS_TOKEN;
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://api.cartesia.ai";
  const wire = settings(request);
  const timeout = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Cartesia synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    if (typeof request.text === "string") {
      const credential = apiKey ?? accessToken;
      if (!credential) throw new TypeError("Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration");
      yield* http(request, request.text, wire, { credential, fetch, baseUrl, signal });
    } else {
      let socket = options.webSocket;
      if (!socket) {
        // Native WebSockets cannot portably attach API-key headers. Exchange the
        // key for a short-lived, TTS-only token; never put the key in the URL.
        let token = accessToken;
        if (!token) {
          if (!apiKey) throw new TypeError("Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration");
          token = await createAccessToken({ credential: apiKey, fetch, baseUrl, signal });
        }
        signal.throwIfAborted();
        const url = new URL(options.webSocketUrl ?? "wss://api.cartesia.ai/tts/websocket");
        url.searchParams.set("cartesia_version", version);
        url.searchParams.set("access_token", token);
        socket = new globalThis.WebSocket(url.href);
      }
      yield* websocket(request.text, {
        ...wire, max_buffer_delay_ms: request.maxBufferDelayMs ?? 3000,
        add_timestamps: request.timestampGranularity?.includes("word") ?? false,
        add_phoneme_timestamps: request.timestampGranularity?.includes("phoneme") ?? false,
        use_normalized_timestamps: request.timestampText === "normalized",
      }, socket, signal);
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
