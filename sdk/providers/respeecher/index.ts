import type { TtsInput, TtsRequest } from "../../../schemas/providers/respeecher/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64, encodeBase64 } from "../../base64.ts";
import type { ClearEvent, DoneEvent, FlushEvent } from "../../dispatch.ts";
import { requestDefaults, validateRequest } from "../../generated/validators/respeecher.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { newlineDelimitedJson } from "../../runtime/ndjson.ts";
import type { SynthesisEnvelope } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsInput } from "../../../schemas/providers/respeecher/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Exclusive, authenticated override; closed when this synthesis ends. */
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  /** Default: WebSocket for PCM/mulaw, byte HTTP for WAV. HTTP streaming is JSONL. */
  readonly transport?: "http" | "websocket";
  readonly signal?: AbortSignal;
  /** Whole-operation deadline, including connection, input and output waits. */
  readonly timeoutMs?: number;
}
type Output = Uint8Array | SynthesisEnvelope | ClearEvent | FlushEvent | DoneEvent;
interface Sampling {
  readonly seed?: number;
  readonly temperature?: number;
  readonly top_k?: number;
  readonly top_p?: number;
  readonly min_p?: number;
  readonly presence_penalty?: number;
  readonly frequency_penalty?: number;
  readonly repetition_penalty?: number;
}
interface Settings {
  readonly voice: { readonly id: string; readonly sampling_params: Sampling };
  readonly output_format: { readonly sample_rate: number; readonly encoding: "pcm_f32le" | "pcm_s16le" | "pcm_mulaw" };
}
type Message =
  | { readonly type: "chunk"; readonly audio: Uint8Array; readonly contextId?: string }
  | { readonly type: "done"; readonly contextId: string }
  | { readonly type: "error"; readonly error: RespeecherError; readonly contextId?: string };

export class RespeecherError extends Error {
  override readonly name = "RespeecherError";
  readonly statusCode: number;
  readonly contextId?: string;
  constructor(statusCode: number, message: string, contextId?: string) {
    super(message); this.statusCode = statusCode;
    if (contextId !== undefined) this.contextId = contextId;
  }
}

function decode(value: unknown, socket: boolean): Message {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Respeecher response");
  const object = value as Record<string, unknown>;
  if (object.context_id !== undefined && typeof object.context_id !== "string") throw new TypeError("Invalid Respeecher context ID");
  const contextId = typeof object.context_id === "string" ? object.context_id : undefined;
  if (object.type === "error") {
    if (typeof object.error !== "string" || !Number.isSafeInteger(object.status_code)) throw new TypeError("Invalid Respeecher error response");
    return { type: "error", error: new RespeecherError(object.status_code as number, object.error, contextId), ...(contextId === undefined ? {} : { contextId }) };
  }
  if (socket && contextId === undefined) throw new TypeError("Respeecher omitted the native context ID");
  if (object.type === "done" && socket && contextId !== undefined) return { type: "done", contextId };
  if (object.type !== "chunk" || typeof object.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(object.data)) throw new TypeError("Invalid Respeecher audio response");
  const audio = decodeBase64(object.data);
  if (encodeBase64(audio) !== object.data) throw new TypeError("Invalid Respeecher audio response");
  return { type: "chunk", audio, ...(contextId === undefined ? {} : { contextId }) };
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

async function* streaming(input: string | AsyncIterable<TtsInput>, settings: Settings, socket: WebSocketLike, signal: AbortSignal, validateInput: (item: unknown) => void): AsyncIterableIterator<Output> {
  const connection = await connectWebSocket({ socket, signal, encode: (value: object) => JSON.stringify(value), decode: data => {
    if (typeof data !== "string") throw new TypeError("Respeecher returned a non-text WebSocket frame");
    return decode(JSON.parse(data), true);
  } });
  let source: AsyncIterator<TtsInput> | undefined; let sourceDone = false;
  const prefix = `${crypto.randomUUID()}:`; let sequence = 0; let clearedThrough = -1;
  const contexts = new Map<string, { ended: boolean; flush: boolean; receivedAudio: boolean }>();
  let current: string | undefined;
  const end = (flush: boolean) => {
    if (current === undefined) return;
    const context = contexts.get(current)!; context.ended = true; context.flush = flush;
    // Empty transcript is valid in the native contract. Send each real delta
    // immediately, then terminate it without waiting for a look-ahead text chunk.
    connection.send({ ...settings, context_id: current, transcript: "", continue: false });
    current = undefined;
  };
  const closeInput = () => {
    if (!source || sourceDone) return;
    sourceDone = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", closeInput, { once: true });
  try {
    signal.throwIfAborted();
    source = typeof input === "string" ? (async function* () { yield input; })() : input[Symbol.asyncIterator]();
    const nextInput = () => Promise.resolve(source!.next()).then(item => ({ type: "input" as const, item }));
    const nextMessage = () => connection.messages.next().then(item => ({ type: "message" as const, item }));
    let pendingInput = nextInput(); let pendingMessage = nextMessage(); let preferInput: boolean = true;
    void pendingInput.catch(() => {}); void pendingMessage.catch(() => {});
    while (!sourceDone || contexts.size) {
      const result: { type: "input"; item: IteratorResult<TtsInput> } | { type: "message"; item: IteratorResult<Message> } = await Promise.race(sourceDone ? [pendingMessage] : preferInput ? [pendingInput, pendingMessage] : [pendingMessage, pendingInput]);
      signal.throwIfAborted(); preferInput = result.type !== "input";
      if (result.type === "message") {
        if (result.item.done) throw new TypeError("Respeecher WebSocket closed before synthesis completed");
        const packet = result.item.value;
        pendingMessage = nextMessage(); void pendingMessage.catch(() => {});
        // Clear cancels every preceding context. A monotonic watermark avoids
        // retaining an ever-growing collection of canceled IDs on long streams.
        const ordinal = packet.contextId?.startsWith(prefix) ? Number(packet.contextId.slice(prefix.length)) : NaN;
        if (Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal <= clearedThrough && packet.contextId === `${prefix}${ordinal}`) continue;
        if (packet.type === "error") throw packet.error;
        const context = packet.contextId === undefined ? undefined : contexts.get(packet.contextId);
        if (!context) throw new TypeError("Respeecher returned an unknown context ID");
        if (packet.type === "chunk") {
          if (packet.audio.byteLength) {
            context.receivedAudio = true;
            yield { correlation: "ordered", correlationId: packet.contextId, audio: packet.audio, timestamps: [] };
          }
        } else {
          if (!context.ended) throw new TypeError("Respeecher completed a context before its text ended");
          if (!context.receivedAudio) throw new TypeError("Respeecher completed a context without audio");
          contexts.delete(packet.contextId);
          if (context.flush) yield { event: "flush", correlationId: packet.contextId, inputGroupId: packet.contextId };
        }
      } else {
        if (result.item.done) { sourceDone = true; end(false); continue; }
        const item = result.item.value;
        if (typeof input !== "string") validateInput(item);
        if (typeof item === "string") {
          if (item) {
            if (current === undefined) { current = `${prefix}${sequence++}`; contexts.set(current, { ended: false, flush: false, receivedAudio: false }); }
            connection.send({ ...settings, context_id: current, transcript: item, continue: true });
          }
        } else if (item.command === "clear") {
          for (const contextId of contexts.keys()) connection.send({ context_id: contextId, cancel: true });
          clearedThrough = sequence - 1; contexts.clear(); current = undefined;
          // Local playback invalidation; the protocol has no cancellation ack.
          yield { event: "clear" };
        } else end(true);
        signal.throwIfAborted(); pendingInput = nextInput(); void pendingInput.catch(() => {});
      }
    }
    signal.throwIfAborted(); yield { event: "done" };
  } finally { signal.removeEventListener("abort", closeInput); closeInput(); connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  const validateInput = validateRequest(request);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.respeecher?.apiKey ?? environment.SPEECHSWITCH_RESPEECHER_API_KEY ?? environment.RESPEECHER_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.respeecher.apiKey configuration");
  const fetch = options.fetch ?? globalThis.fetch;
  const language = request.language ?? requestDefaults.language;
  const baseUrl = options.baseUrl ?? `https://api.respeecher.com/v1/public/tts/${language === "uk" ? "ua" : "en"}-rt`;
  const output = request.output ?? { format: "pcm" };
  const wave = output.format === "wav";
  const socketMode = options.transport ? options.transport === "websocket" : !wave;
  if (wave && socketMode) throw new TypeError("Respeecher WAV output requires HTTP");
  if (!socketMode && typeof request.text !== "string") throw new TypeError("Respeecher incremental text requires WebSocket");
  if (!socketMode && options.webSocket) throw new TypeError("Respeecher HTTP cannot use a WebSocket override");
  const settings: Settings = {
    voice: { id: request.voice, sampling_params: {
      ...(request.randomSeed === undefined ? {} : { seed: request.randomSeed }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.topK === undefined ? {} : { top_k: request.topK === 0 ? -1 : request.topK }),
      ...(request.topP === undefined ? {} : { top_p: request.topP }),
      ...(request.minP === undefined ? {} : { min_p: request.minP }),
      ...(request.presencePenalty === undefined ? {} : { presence_penalty: request.presencePenalty }),
      ...(request.frequencyPenalty === undefined ? {} : { frequency_penalty: request.frequencyPenalty }),
      ...(request.repetitionPenalty === undefined ? {} : { repetition_penalty: request.repetitionPenalty }),
    } },
    output_format: { sample_rate: output.sampleRateHz ?? 22050, encoding: output.format === "mulaw" ? "pcm_mulaw" : output.sampleEncoding === "signed_integer_16" ? "pcm_s16le" : "pcm_f32le" },
  };
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Respeecher timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("Respeecher synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Respeecher synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    if (socketMode) {
      let socket = options.webSocket;
      if (!socket) {
        if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("Respeecher native WebSocket auth requires Node or Bun; supply an authenticated socket or use HTTP in browsers");
        const url = new URL(options.webSocketUrl ?? baseUrl);
        if (!options.webSocketUrl) { url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = `${url.pathname.replace(/\/$/, "")}/tts/websocket`; }
        const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
        if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
        socket = new Constructor(url.href, { headers: { "X-API-Key": apiKey } });
      }
      yield* streaming(request.text, settings, socket, signal, validateInput); return;
    }
    const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/$/, "")}/tts/${wave ? "bytes" : "sse"}`;
    const pending = fetch(url, { method: "POST", redirect: "error", signal, headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: request.text, voice: settings.voice, output_format: wave ? { sample_rate: settings.output_format.sample_rate } : settings.output_format }) });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new RespeecherError(response.status, `Respeecher returned HTTP ${response.status}`); }
    if (!response.body) throw new TypeError("Respeecher returned no audio body");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType && (wave ? !contentType.startsWith("audio/") && contentType !== "application/octet-stream" : !["text/event-stream", "application/x-ndjson", "application/jsonl", "application/json"].includes(contentType))) {
      void response.body.cancel().catch(() => {}); throw new TypeError("Respeecher returned an unexpected content type");
    }
    let receivedAudio = false;
    if (wave) for await (const audio of bytes(response.body, signal, aborted)) { receivedAudio = true; yield audio; }
    else for await (const value of newlineDelimitedJson(bytes(response.body, signal, aborted))) {
      signal.throwIfAborted(); const packet = decode(value, false);
      if (packet.type === "error") throw packet.error;
      if (packet.type === "chunk" && packet.audio.byteLength) { receivedAudio = true; yield packet.audio; }
    }
    signal.throwIfAborted();
    if (!receivedAudio) throw new TypeError("Respeecher returned no audio");
    yield { event: "done" };
  } finally { if (timer !== undefined) clearTimeout(timer); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
