import type { TtsRequest } from "../../../schemas/providers/hume/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import { validateRequest } from "../../generated/validators/hume.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { newlineDelimitedJson } from "../../runtime/ndjson.ts";
import type { Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest } from "../../../schemas/providers/hume/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Exclusive authenticated streaming-input socket, closed on completion. */
  readonly webSocket?: WebSocketLike;
  /** API root; /v0/tts is appended. */
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
  /** Whole-operation deadline, including stalled input or network waits. */
  readonly timeoutMs?: number;
  /** Return native generation/snippet identifiers without requesting timestamps. Uses JSON audio transport. */
  readonly includeMetadata?: boolean;
}
export interface HumeEnvelope {
  readonly correlation: "timeline";
  readonly correlationId: string;
  readonly generationId: string;
  readonly requestId: string;
  readonly audio?: Uint8Array;
  readonly inputGroupId?: string;
  readonly timestamps: readonly Timestamp<"word" | "phoneme">[];
  readonly chunkIndex?: number;
  readonly isLastChunk?: boolean;
}
export class HumeError extends Error {
  readonly statusCode: number | null;
  readonly code: string | null;
  constructor(message: string, statusCode: number | null, code: string | null) {
    super(message); this.name = "HumeError"; this.statusCode = statusCode; this.code = code;
  }
}

// Fern omits the streaming response item/framing; AsyncAPI omits binary audio
// and error frames. Implement the documented protocol here, not in fake codegen.
interface VoiceSelection { readonly voice?: string; readonly voiceName?: string; readonly voiceSource?: "catalog" | "custom"; readonly voiceDescription?: string }
interface Delivery { readonly instructions?: string; readonly speed?: number; readonly trailingSilenceMs?: number }
interface Turn extends Delivery { readonly speaker: string; readonly text: string }
type Input = string | Turn | { readonly command: "flush" };
interface Utterance {
  readonly text: string;
  readonly voice?: { readonly id: string; readonly provider: "HUME_AI" | "CUSTOM_VOICE" } | { readonly name: string; readonly provider: "HUME_AI" | "CUSTOM_VOICE" };
  readonly description?: string;
  readonly speed: number;
  readonly trailing_silence: number;
}
type ClientMessage = Utterance | { readonly flush: true } | { readonly close: true };
interface Mark { readonly type: "word" | "phoneme"; readonly text: string; readonly time: { readonly begin: number; readonly end: number } }
interface Identifiers { readonly generation_id: string; readonly request_id: string; readonly snippet_id: string }
type Packet = (Identifiers & { readonly type: "audio"; readonly audio?: string; readonly chunk_index: number; readonly is_last_chunk: boolean; readonly utterance_index?: number | null })
  | (Identifiers & { readonly type: "timestamp"; readonly timestamp: Mark });
type Output = Uint8Array | HumeEnvelope;

function decodePacket(value: unknown, binary: boolean): Packet {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Hume returned an invalid event");
  const message = value as Record<string, unknown>;
  if (typeof message.error === "string" || message.type === "error") {
    throw new HumeError(typeof message.message === "string" ? message.message : typeof message.error === "string" ? message.error : "Hume synthesis failed", null, typeof message.code === "string" ? message.code : null);
  }
  if (typeof message.generation_id !== "string" || typeof message.request_id !== "string" || typeof message.snippet_id !== "string") throw new TypeError("Hume returned invalid correlation identifiers");
  if (message.type === "audio") {
    if ((!binary && typeof message.audio !== "string") || (message.audio !== undefined && typeof message.audio !== "string")
      || typeof message.chunk_index !== "number" || !Number.isSafeInteger(message.chunk_index) || message.chunk_index < 0 || typeof message.is_last_chunk !== "boolean"
      || (message.utterance_index != null && (typeof message.utterance_index !== "number" || !Number.isSafeInteger(message.utterance_index) || message.utterance_index < 0))) throw new TypeError("Hume returned an invalid audio event");
    return message as unknown as Packet;
  }
  if (message.type === "timestamp") {
    const mark = message.timestamp as Partial<Mark> | null;
    if (!mark || (mark.type !== "word" && mark.type !== "phoneme") || typeof mark.text !== "string" || !mark.time
      || !Number.isSafeInteger(mark.time.begin) || !Number.isSafeInteger(mark.time.end) || mark.time.begin < 0 || mark.time.end < mark.time.begin) throw new TypeError("Hume returned an invalid timestamp");
    return message as unknown as Packet;
  }
  throw new TypeError("Hume returned an invalid event");
}

function envelope(packet: Packet): HumeEnvelope {
  const ids = { correlation: "timeline" as const, correlationId: packet.snippet_id, generationId: packet.generation_id, requestId: packet.request_id };
  // Native timestamps describe the parent snippet, not the neighboring audio
  // packet. Never attach them to audio by arrival order or duplicate the final
  // snippet's aggregate audio/timestamps over the incremental stream.
  return packet.type === "audio" ? { ...ids, audio: decodeBase64(packet.audio!), timestamps: [], chunkIndex: packet.chunk_index, isLastChunk: packet.is_last_chunk,
    ...(packet.utterance_index == null ? {} : { inputGroupId: String(packet.utterance_index) }) }
    : { ...ids, timestamps: [{ kind: packet.timestamp.type, value: packet.timestamp.text, startTimeMs: packet.timestamp.time.begin, endTimeMs: packet.timestamp.time.end }] };
}

async function* responseBytes(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  try {
    for (;;) { signal.throwIfAborted(); const item = await reader.read(); signal.throwIfAborted(); if (item.done) return; yield item.value; }
  } finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function* streamInput(input: AsyncIterable<Input>, socket: WebSocketLike, signal: AbortSignal, metadata: boolean,
  makeUtterance: (value: string | Turn) => Utterance, validate: (value: unknown) => void): AsyncIterableIterator<Output> {
  let closeCode: number | undefined;
  const onClose = (event: unknown) => { closeCode = (event as { code?: number } | null)?.code; };
  socket.addEventListener("close", onClose);
  let connection: Awaited<ReturnType<typeof connectWebSocket<ClientMessage, Packet | Uint8Array>>> | undefined;
  let source: AsyncIterator<Input> | undefined; let inputDone = false; let stopped = false;
  const stop = () => {
    if (!source || inputDone || stopped) return; stopped = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    connection = await connectWebSocket({ socket, signal, encode: (message: ClientMessage) => JSON.stringify(message), decode: data => {
      if (typeof data === "string") return decodePacket(JSON.parse(data), !metadata);
      if (metadata) throw new TypeError("Hume returned binary audio in JSON mode");
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      throw new TypeError("Hume returned an invalid WebSocket frame");
    } });
    signal.throwIfAborted(); source = input[Symbol.asyncIterator]();
    const nextInput = () => Promise.resolve().then(() => { signal.throwIfAborted(); return source!.next(); }).then(value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }));
    const nextOutput = () => connection!.messages.next().then(value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }));
    let pendingInput = nextInput(); let pendingOutput = nextOutput(); let preferInput = false;
    for (;;) {
      const event = await (inputDone ? pendingOutput : Promise.race(preferInput ? [pendingInput, pendingOutput] : [pendingOutput, pendingInput]));
      signal.throwIfAborted(); preferInput = !preferInput;
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        if (event.value.done) { inputDone = true; connection.send({ close: true }); }
        else {
          const value = event.value.value; validate(value);
          connection.send(typeof value !== "string" && "command" in value ? { flush: true } : makeUtterance(value));
          pendingInput = nextInput();
        }
      } else {
        if (event.value.done) {
          if (!inputDone) throw new TypeError("Hume WebSocket closed before the input stream ended");
          if (closeCode !== undefined && closeCode !== 1000) throw new HumeError(`Hume WebSocket closed with code ${closeCode}`, null, String(closeCode));
          return;
        }
        const packet = event.value.value;
        if (packet instanceof Uint8Array) yield packet;
        else if (metadata) yield envelope(packet);
        // In binary mode JSON is metadata, not a second copy of the audio.
        pendingOutput = nextOutput();
      }
    }
  } finally { stop(); signal.removeEventListener("abort", stop); socket.removeEventListener("close", onClose); connection?.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  const validateItem = validateRequest(request);
  const priorIds = request.contextBefore?.requestIds;
  if (priorIds && (priorIds.length !== 1 || !priorIds[0])) throw new TypeError("Hume continuation requires exactly one non-empty generation ID");
  const speakers = new Map<string, VoiceSelection>();
  if (request.speakers) {
    if (!request.speakers.length) throw new TypeError("Hume speakers must not be empty");
    for (const speaker of request.speakers) {
      if (!speaker.alias || speakers.has(speaker.alias)) throw new TypeError("Hume speaker aliases must be non-empty and unique");
      speakers.set(speaker.alias, speaker);
    }
  }
  const utterance = (value: string | Turn): Utterance => {
    let selection: VoiceSelection = request;
    if (typeof value !== "string") {
      const speaker = speakers.get(value.speaker);
      if (!speaker) throw new TypeError(`Unknown Hume speaker: ${value.speaker}`);
      selection = speaker;
    }
    const delivery = typeof value === "string" ? request : value;
    const text = typeof value === "string" ? value : value.text;
    const provider = selection.voiceSource === "catalog" ? "HUME_AI" : "CUSTOM_VOICE";
    return { text, ...(selection.voice !== undefined ? { voice: { id: selection.voice, provider } } : selection.voiceName !== undefined ? { voice: { name: selection.voiceName, provider } } : {}),
      description: selection.voiceDescription ?? delivery.instructions, speed: delivery.speed ?? request.speed ?? 1,
      trailing_silence: (delivery.trailingSilenceMs ?? request.trailingSilenceMs ?? 0) / 1000 };
  };
  const staticInput = typeof request.text === "string" ? [utterance(request.text)] : Array.isArray(request.turns) ? request.turns.map(utterance) : undefined;
  if (staticInput?.length === 0) throw new TypeError("Hume turns must not be empty");
  const context = priorIds ? { generation_id: priorIds[0]! } : request.contextBefore?.text !== undefined ? { utterances: [utterance(request.contextBefore.text)] }
    : request.contextBefore?.turns ? { utterances: request.contextBefore.turns.map(utterance) } : undefined;
  if (context?.utterances?.length === 0) throw new TypeError("Hume context turns must not be empty");
  if (options.webSocket && staticInput) throw new TypeError("Hume webSocket overrides require streaming input");
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.hume?.apiKey ?? environment.SPEECHSWITCH_HUME_API_KEY ?? environment.HUME_API_KEY;
  const token = options.auth?.hume?.accessToken;
  if (!apiKey && !token && !options.webSocket) throw new TypeError("Missing auth.hume.apiKey configuration");
  const baseUrl = options.baseUrl ?? "https://api.hume.ai";
  const fetch = options.fetch ?? globalThis.fetch;
  const metadata = options.includeMetadata === true || request.timestampGranularity !== undefined;
  const timestampKinds = request.timestampGranularity === undefined ? [] : typeof request.timestampGranularity === "string" ? [request.timestampGranularity] : request.timestampGranularity;
  const version = request.model === "octave-1" ? "1" : "2";
  const instant = request.latencyOptimization !== "none" && (request.voice !== undefined || request.voiceName !== undefined || request.speakers !== undefined);
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Hume timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("Hume synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timeout = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Hume synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    if (!staticInput) {
      let socket = options.webSocket;
      if (!socket) {
        const url = new URL(options.webSocketUrl ?? baseUrl);
        if (!options.webSocketUrl) { url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = `${url.pathname.replace(/\/$/, "")}/v0/tts/stream/input`; }
        // Both credentials are documented native socket query authentication.
        // Supply a short-lived access token to browsers, never a private API key.
        url.searchParams.delete("api_key"); url.searchParams.delete("access_token");
        url.searchParams.set(token ? "access_token" : "api_key", token ?? apiKey!);
        url.searchParams.set("format_type", request.output.format); url.searchParams.set("version", version);
        url.searchParams.set("instant_mode", String(instant)); url.searchParams.set("no_binary", String(metadata)); url.searchParams.set("strip_headers", "true");
        url.searchParams.delete("include_timestamp_types"); for (const kind of timestampKinds) url.searchParams.append("include_timestamp_types", kind);
        if (priorIds) url.searchParams.set("context_generation_id", priorIds[0]!);
        if (request.temperature !== undefined) url.searchParams.set("temperature", String(request.temperature));
        if (!globalThis.WebSocket) throw new TypeError("This runtime does not provide WebSocket");
        socket = new globalThis.WebSocket(url.href);
      }
      const input = (request.text ?? request.turns) as AsyncIterable<Input>;
      yield* streamInput(input, socket, signal, metadata, utterance, value => {
        validateItem(value, request.text === undefined ? "turns" : "text");
        // Specgen supports property bounds, but not bounds on bare strings
        // inside AsyncIterable. Static text and structured turns are generated.
        if (typeof value === "string" && value.length > 5000) throw new TypeError("Hume text must not exceed 5000 characters per utterance");
      });
      return;
    }
    const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/$/, "")}/v0/tts/stream/${metadata ? "json" : "file"}`;
    const pendingResponse = fetch(url, { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : { "X-Hume-Api-Key": apiKey! }), "content-type": "application/json" }, signal,
      body: JSON.stringify({ utterances: staticInput, context, version, format: { type: request.output.format }, include_timestamp_types: timestampKinds,
        num_generations: 1, split_utterances: request.splitTurns ?? true, strip_headers: true, temperature: request.temperature, instant_mode: instant }) });
    void pendingResponse.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pendingResponse, aborted]);
    if (!response.ok) {
      const body = await Promise.race([response.text(), aborted]); let detail: unknown;
      try { detail = JSON.parse(body); } catch {}
      const error = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
      throw new HumeError(typeof error.message === "string" ? error.message : typeof error.error === "string" ? error.error : body, response.status, typeof error.code === "string" ? error.code : null);
    }
    if (!response.body) throw new TypeError("Hume returned no audio stream");
    const bytes = responseBytes(response.body, signal);
    const iterator = (metadata ? newlineDelimitedJson(bytes) : bytes)[Symbol.asyncIterator](); let done = false;
    try {
      for (;;) {
        const item = await Promise.race([iterator.next(), aborted]); signal.throwIfAborted();
        if (item.done) { done = true; return; }
        yield metadata ? envelope(decodePacket(item.value, false)) : item.value as Uint8Array;
      }
    } finally { if (!done) { try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch {} } }
  } finally { if (timeout !== undefined) clearTimeout(timeout); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
