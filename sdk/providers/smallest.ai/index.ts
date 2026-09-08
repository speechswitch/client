import type { TtsRequest, TtsInput, SmallestEnvelope, SmallestBatchEvent } from "../../../schemas/providers/smallest.ai/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64, encodeBase64 } from "../../base64.ts";
import type { ClearEvent, DoneEvent } from "../../dispatch.ts";
import { requestDefaults, validateRequest } from "../../generated/validators/smallest.ai.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { serverSentEvents } from "../../runtime/sse.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsInput, SmallestEnvelope, SmallestBatchEvent } from "../../../schemas/providers/smallest.ai/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Exclusive, preauthenticated override; closed when this synthesis ends. */
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  /** SSE for whole text; WebSocket for incremental text or timestamps. HTTP is the non-streaming upstream byte endpoint. */
  readonly transport?: "http" | "sse" | "websocket";
  readonly signal?: AbortSignal;
  /** Whole-operation deadline, not evidence of successful synthesis completion. */
  readonly timeoutMs?: number;
  /** Server WebSocket idle timeout, in seconds. */
  readonly idleTimeoutSeconds?: number;
}
type Output = Uint8Array | SmallestEnvelope | SmallestBatchEvent | ClearEvent | DoneEvent;
type Packet =
  | { readonly status: "chunk"; readonly requestId: string; readonly externalRequestId?: string; readonly audio: Uint8Array }
  | { readonly status: "word_timestamp"; readonly requestId: string; readonly externalRequestId?: string; readonly wordIndex: number; readonly timestamps: SmallestEnvelope["timestamps"] }
  | { readonly status: "complete"; readonly requestId: string; readonly externalRequestId?: string }
  | { readonly status: "error"; readonly error: SmallestError };

export class SmallestError extends Error {
  override readonly name = "SmallestError";
  readonly status?: number;
  readonly code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message); if (status !== undefined) this.status = status; if (code !== undefined) this.code = code;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Smallest.ai response object");
  return value as Record<string, unknown>;
}
function audio(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError("Invalid Smallest.ai base64 audio");
  const bytes = decodeBase64(value);
  if (encodeBase64(bytes) !== value) throw new TypeError("Invalid Smallest.ai base64 audio");
  return bytes;
}
function decode(data: unknown): Packet {
  if (typeof data !== "string") throw new TypeError("Smallest.ai returned a non-text WebSocket frame");
  const value = object(JSON.parse(data));
  if (value.status === "error") {
    const error = value.error === undefined ? value : object(value.error);
    if (typeof error.message !== "string" || (error.code !== undefined && typeof error.code !== "string")) throw new TypeError("Invalid Smallest.ai error response");
    return { status: "error", error: new SmallestError(error.message, undefined, error.code) };
  }
  if (typeof value.request_id !== "string" || !value.request_id || (value.external_request_id !== undefined && typeof value.external_request_id !== "string")) throw new TypeError("Invalid Smallest.ai request identity");
  const identity = { requestId: value.request_id, ...(value.external_request_id === undefined ? {} : { externalRequestId: value.external_request_id }) };
  if (value.status === "complete") return { status: "complete", ...identity };
  const payload = object(value.data);
  if (value.status === "chunk") return { status: "chunk", ...identity, audio: audio(payload.audio) };
  if (value.status !== "word_timestamp") throw new TypeError("Unknown Smallest.ai WebSocket status");
  const { id, word, start, end } = payload;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || typeof word !== "string" || typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start * 1000) || !Number.isFinite(end * 1000) || start < 0 || end < start) throw new TypeError("Invalid Smallest.ai word timestamp");
  return { status: "word_timestamp", ...identity, wordIndex: id, timestamps: [{ kind: "word", value: word, startTimeMs: start * 1000, endTimeMs: end * 1000 }] };
}

async function* bytes(body: ReadableStream<Uint8Array>, signal: AbortSignal, aborted: Promise<never>): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const item = await Promise.race([reader.read(), aborted]); signal.throwIfAborted();
      if (item.done) return;
      if (item.value.byteLength) yield item.value;
    }
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function* streaming(request: TtsRequest, text: string | AsyncIterable<TtsInput>, settings: object, socket: WebSocketLike,
  signal: AbortSignal, validateInput: (item: unknown) => void): AsyncIterableIterator<Output> {
  let source: AsyncIterator<TtsInput> | undefined; let sourceDone = false;
  const closeInput = () => {
    if (!source || sourceDone) return;
    sourceDone = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", closeInput, { once: true });
  let connection: Awaited<ReturnType<typeof connectWebSocket<object, Packet>>> | undefined;
  try {
    connection = await connectWebSocket({ socket, signal, encode: (value: object) => JSON.stringify(value), decode });
    signal.throwIfAborted();
    source = typeof text === "string" ? (async function* () { yield text; })() : text[Symbol.asyncIterator]();
    const nextInput = () => Promise.resolve(source!.next()).then(item => ({ type: "input" as const, item }));
    const nextMessage = () => connection!.messages.next().then(item => ({ type: "message" as const, item }));
    let pendingInput = nextInput(); let pendingMessage = nextMessage(); let preferInput: boolean = true;
    void pendingInput.catch(() => {}); void pendingMessage.catch(() => {});
    let sentText = false; let receivedAudio = false; let ended = false;
    const stale = new Set<string>(); let externalId = request.requestId ?? crypto.randomUUID();
    for (;;) {
      const result: { type: "input"; item: IteratorResult<TtsInput> } | { type: "message"; item: IteratorResult<Packet> } = await Promise.race(sourceDone ? [pendingMessage] : preferInput ? [pendingInput, pendingMessage] : [pendingMessage, pendingInput]);
      signal.throwIfAborted(); preferInput = result.type !== "input";
      if (result.type === "input") {
        if (result.item.done) {
          sourceDone = true;
          if (!sentText && !request.continuation) { yield { event: "done" }; return; }
          if (typeof text !== "string") {
            ended = true;
            connection.send(request.continuation
              ? { context_id: request.continuation.id, voice_id: request.voice, continue: false }
              : { ...settings, text: "", request_id: externalId, continue: false, flush: true,
                max_buffer_flush_ms: request.maxBufferDelayMs ?? 0, complete_backoff_ms: request.completionDelayMs ?? 4000 });
          }
          continue;
        }
        const item = result.item.value;
        if (typeof text !== "string") validateInput(item);
        if (typeof item === "string") {
          if (item) {
            sentText = true;
            if (typeof text === "string") ended = true;
            connection.send({ ...settings, text: item, request_id: externalId,
              ...(request.continuation
                ? { context_id: request.continuation.id, continue: true, max_buffer_delay_ms: request.continuation.maxBufferDelayMs ?? 3000 }
                : typeof text === "string" ? {} : { continue: true, max_buffer_flush_ms: request.maxBufferDelayMs ?? 0, complete_backoff_ms: request.completionDelayMs ?? 4000 }) });
          }
        } else {
          connection.send({ context_id: request.continuation!.id, cancel_request: true });
          stale.add(externalId); externalId = crypto.randomUUID();
          // Native cancellation only discards buffered text. There is no ack.
          // Echoed external IDs let us drop known older frames, never guess by order.
          yield { event: "clear" };
        }
        signal.throwIfAborted(); pendingInput = nextInput(); void pendingInput.catch(() => {});
      } else {
        if (result.item.done) throw new TypeError(request.continuation
          ? "Smallest.ai continuation closed without a context-complete marker"
          : "Smallest.ai WebSocket closed before completion");
        const packet = result.item.value;
        pendingMessage = nextMessage(); void pendingMessage.catch(() => {});
        if (packet.status === "error") throw packet.error;
        if (stale.size) {
          if (!packet.externalRequestId) throw new TypeError("Smallest.ai omitted external request identity after clear");
          if (stale.has(packet.externalRequestId)) continue;
          if (packet.externalRequestId !== externalId) throw new TypeError("Smallest.ai returned an unknown external request identity after clear");
        }
        if (packet.status === "complete") {
          if (request.continuation) { yield { event: "batch", requestId: packet.requestId }; continue; }
          if (!ended) throw new TypeError("Smallest.ai completed before input ended");
          if (!receivedAudio) throw new TypeError("Smallest.ai returned no audio");
          signal.throwIfAborted(); yield { event: "done" }; return;
        }
        if (packet.status === "chunk") {
          if (packet.audio.byteLength) {
            receivedAudio = true;
            yield request.timestampGranularity ? { correlation: "ordered", correlationId: packet.requestId, audio: packet.audio, timestamps: [] } : packet.audio;
          }
        } else if (request.timestampGranularity) yield { correlation: "ordered", correlationId: packet.requestId, timestamps: packet.timestamps, wordIndex: packet.wordIndex };
      }
    }
  } finally {
    signal.removeEventListener("abort", closeInput); closeInput(); connection?.close();
    if (!connection && socket.readyState < 2) socket.close();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  const text = typeof request?.text === "string" ? request.text.trim() : request?.text;
  const validateInput = validateRequest({ ...request, text });
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.["smallest.ai"]?.apiKey ?? environment.SPEECHSWITCH_SMALLEST_API_KEY ?? environment.SMALLEST_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.smallest.ai.apiKey configuration");
  const socketRequired = typeof text !== "string" || request.timestampGranularity !== undefined;
  const transport = options.transport ?? (socketRequired || options.webSocket !== undefined || options.webSocketUrl !== undefined ? "websocket" : "sse");
  if (transport !== "websocket" && (socketRequired || options.webSocket !== undefined || options.webSocketUrl !== undefined)) throw new TypeError("Smallest.ai incremental text, timestamps and socket overrides require WebSocket transport");
  if (transport === "websocket" && request.pronunciationDictionaries !== undefined) throw new TypeError("Smallest.ai pronunciation dictionaries are documented only for HTTP/SSE");
  if (request.continuation && options.signal === undefined && options.timeoutMs === undefined) throw new TypeError("Smallest.ai continuations require a signal or deadline; the server has no final context-complete marker");
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Smallest.ai timeoutMs must be an integer between 0 and 2147483647");
  const idleTimeout = options.idleTimeoutSeconds ?? 60;
  if (!Number.isSafeInteger(idleTimeout) || idleTimeout <= 0) throw new TypeError("Smallest.ai idleTimeoutSeconds must be a positive safe integer");
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, ...(request.contentRetentionDays === undefined ? {} : { "x-expire-content": "true" }) };
  const format = request.output?.format ?? "pcm";
  const settings = {
    voice_id: request.voice, model: request.model === "lightning-v3.1" ? "lightning_v3.1" : "lightning_v3.1_pro",
    language: request.language ?? (request.timestampGranularity ? "en" : "auto"), sample_rate: request.output?.sampleRateHz ?? 44100,
    output_format: format === "mulaw" ? "ulaw" : format, speed: request.speed ?? requestDefaults.speed,
    math_notation: request.formulaReading === "plain_text",
    ...(request.numberPronunciationLanguage === undefined ? {} : { number_pronunciation_language: request.numberPronunciationLanguage }),
    ...(request.sessionId === undefined ? {} : { session_id: request.sessionId }),
    ...(request.requestId === undefined ? {} : { request_id: request.requestId }),
    ...(request.pronunciationDictionaries === undefined ? {} : { pronunciation_dicts: request.pronunciationDictionaries.map(dictionary => dictionary.id) }),
    ...(request.timestampGranularity === undefined ? {} : { word_timestamps: true }),
  };
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("Smallest.ai synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Smallest.ai synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    const url = new URL(options.baseUrl ?? "https://api.smallest.ai"); url.pathname = `${url.pathname.replace(/\/$/, "")}/waves/v1/tts${transport === "http" ? "" : "/live"}`;
    if (transport === "websocket") {
      let socket = options.webSocket;
      if (!socket) {
        if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("Smallest.ai native WebSocket auth requires Node or Bun; supply an authenticated socket or use SSE in browsers");
        const endpoint = options.webSocketUrl ? new URL(options.webSocketUrl) : url;
        endpoint.protocol = endpoint.protocol === "https:" || endpoint.protocol === "wss:" ? "wss:" : "ws:";
        endpoint.searchParams.set("timeout", String(idleTimeout));
        const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
        if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
        socket = new Constructor(endpoint.href, { headers });
      }
      yield* streaming(request, text, settings, socket, signal, validateInput); return;
    }
    const fetch = options.fetch ?? globalThis.fetch;
    const pending = fetch(url, { method: "POST", redirect: "error", signal,
      headers: { ...headers, "Content-Type": "application/json", Accept: transport === "http" ? "audio/wav" : "text/event-stream" }, body: JSON.stringify({ ...settings, text }) });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new SmallestError(`Smallest.ai returned HTTP ${response.status}`, response.status); }
    if (!response.body) throw new TypeError("Smallest.ai returned no audio body");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType && (transport === "http" ? !contentType.startsWith("audio/") && contentType !== "application/octet-stream" : contentType !== "text/event-stream")) {
      void response.body.cancel().catch(() => {}); throw new TypeError("Smallest.ai returned an unexpected content type");
    }
    let receivedAudio = false;
    if (transport === "http") {
      for await (const chunk of bytes(response.body, signal, aborted)) { receivedAudio = true; yield chunk; }
    } else {
      let done = false;
      for await (const event of serverSentEvents(bytes(response.body, signal, aborted), true)) {
        signal.throwIfAborted(); const value = object(JSON.parse(event.data));
        if (event.event === "error" || value.status === "error" || value.error !== undefined) throw new SmallestError("Smallest.ai SSE returned an error");
        if (typeof value.done !== "boolean" || (value.status !== "206" && value.status !== "200") || value.done !== (value.status === "200")) throw new TypeError("Invalid Smallest.ai SSE status");
        if (value.audio !== undefined) {
          const chunk = audio(value.audio); if (chunk.byteLength) { receivedAudio = true; yield chunk; }
        } else if (!value.done) throw new TypeError("Smallest.ai SSE chunk omitted audio");
        if (value.done) { done = true; break; }
      }
      if (!done) throw new TypeError("Smallest.ai SSE ended before completion");
    }
    signal.throwIfAborted(); if (!receivedAudio) throw new TypeError("Smallest.ai returned no audio");
    yield { event: "done" };
  } finally { if (timer !== undefined) clearTimeout(timer); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
