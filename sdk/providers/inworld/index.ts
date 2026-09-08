import type { TtsRequest, InworldTimestamp, SynthesisItem as Output } from "../../../schemas/providers/inworld/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import { requestDefaults, validateRequest } from "../../generated/validators/inworld.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { newlineDelimitedJson } from "../../runtime/ndjson.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, InworldTimestamp, InworldChunkEnvelope, InworldTimelineEnvelope, InworldEnvelope, SynthesisItem } from "../../../schemas/providers/inworld/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Exclusive authenticated socket for streaming input; closed when this operation ends. */
  readonly webSocket?: WebSocketLike;
  /** API origin or proxy root. */
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  /** Static input defaults to HTTP streaming. Single-response mode has a 2000-character limit. */
  readonly httpMode?: "stream" | "single";
  readonly signal?: AbortSignal;
  /** Deadline for the whole operation, including producer and transport waits. */
  readonly timeoutMs?: number;
  /** Logical context identifier, used only with streaming input. */
  readonly contextId?: string;
}
type Input = string | { readonly command: "flush" };
interface ContextSettings {
  readonly voiceId: string;
  readonly modelId: string;
  readonly audioConfig: { readonly audioEncoding: string; readonly sampleRateHertz: number; readonly speakingRate: number; readonly bitRate?: number };
  readonly deliveryMode?: string;
  readonly temperature?: number;
  readonly language?: string;
  readonly applyTextNormalization: string;
  readonly timestampType: string;
  readonly timestampTransportStrategy: "SYNC" | "ASYNC";
  readonly maxBufferDelayMs: number;
  readonly bufferCharThreshold: number;
  readonly autoMode: boolean;
}
export class InworldError extends Error {
  readonly statusCode: number | null;
  readonly code: number | null;
  constructor(message: string, statusCode: number | null, code: number | null) {
    super(message); this.name = "InworldError"; this.statusCode = statusCode; this.code = code;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Inworld returned an invalid object");
  return value as Record<string, unknown>;
}
function status(value: unknown, statusCode: number | null = null): void {
  if (value === undefined) return;
  const result = object(value);
  if (result.code !== undefined && (typeof result.code !== "number" || !Number.isSafeInteger(result.code))) throw new TypeError("Inworld returned an invalid status code");
  if (result.message !== undefined && typeof result.message !== "string") throw new TypeError("Inworld returned an invalid status message");
  if (result.code !== undefined && result.code !== 0) throw new InworldError(typeof result.message === "string" ? result.message : `Inworld status ${result.code}`, statusCode, result.code as number);
}
function seconds(value: unknown): number {
  if (typeof value !== "number" || value < 0 || !Number.isFinite(value * 1000)) throw new TypeError("Inworld returned an invalid timestamp");
  return value * 1000;
}
function timestamps(value: unknown): InworldTimestamp[] {
  if (value === undefined) return [];
  const info = object(value); const marks: InworldTimestamp[] = [];
  for (const kind of ["word", "character"] as const) {
    const raw = info[`${kind}Alignment`]; if (raw === undefined) continue;
    const alignment = object(raw); const values = alignment[`${kind}s`];
    const starts = alignment[`${kind}StartTimeSeconds`]; const ends = alignment[`${kind}EndTimeSeconds`];
    if (!Array.isArray(values) || !Array.isArray(starts) || !Array.isArray(ends) || values.length !== starts.length || values.length !== ends.length) throw new TypeError("Inworld returned mismatched timestamp arrays");
    values.forEach((value, index) => {
      if (typeof value !== "string") throw new TypeError("Inworld returned an invalid alignment token");
      const startTimeMs = seconds(starts[index]); const endTimeMs = seconds(ends[index]);
      if (endTimeMs < startTimeMs) throw new TypeError("Inworld returned a reversed timestamp range");
      marks.push({ kind, value, startTimeMs, endTimeMs, ...(kind === "word" ? { wordIndex: index } : {}) });
    });
    if (kind !== "word" || alignment.phoneticDetails === undefined) continue;
    if (!Array.isArray(alignment.phoneticDetails)) throw new TypeError("Inworld returned invalid phonetic details");
    for (const item of alignment.phoneticDetails) {
      const detail = object(item); const wordIndex = detail.wordIndex;
      if (typeof wordIndex !== "number" || !Number.isSafeInteger(wordIndex) || wordIndex < 0 || wordIndex >= values.length || !Array.isArray(detail.phones)) throw new TypeError("Inworld returned an invalid phonetic word index");
      for (const item of detail.phones) {
        const phone = object(item);
        if (typeof phone.phoneSymbol !== "string" || (phone.visemeSymbol !== undefined && typeof phone.visemeSymbol !== "string")) throw new TypeError("Inworld returned an invalid phone or viseme");
        const startTimeMs = seconds(phone.startTimeSeconds); const endTimeMs = startTimeMs + seconds(phone.durationSeconds);
        if (!Number.isFinite(endTimeMs)) throw new TypeError("Inworld returned an invalid timestamp");
        marks.push({ kind: "phoneme", value: phone.phoneSymbol, startTimeMs, endTimeMs, wordIndex });
        if (typeof phone.visemeSymbol === "string") marks.push({ kind: "viseme", value: phone.visemeSymbol, startTimeMs, endTimeMs, wordIndex });
      }
    }
  }
  return marks;
}

// Inworld WAV restarts its header per flush. Preserve the first format/header,
// strip subsequent headers, and mark sizes unknown for one incremental WAV.
// Consumers writing a seekable file can finalize RIFF/data sizes after buffering.
class WaveStream {
  private pending = new Uint8Array(0);
  private header = true;
  private format: Uint8Array | undefined;
  boundary() {
    if (this.pending.length) throw new TypeError("Inworld returned an incomplete WAV header");
    this.header = true;
  }
  audio(bytes: Uint8Array): Uint8Array {
    if (!this.header) return bytes;
    const data = new Uint8Array(this.pending.length + bytes.length); data.set(this.pending); data.set(bytes, this.pending.length); this.pending = data;
    const tag = (offset: number) => String.fromCharCode(...data.subarray(offset, offset + 4));
    if (data.length < 12) return new Uint8Array(0);
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new TypeError("Inworld returned an invalid WAV header");
    const view = new DataView(data.buffer); let format: Uint8Array | undefined;
    for (let offset = 12; offset + 8 <= data.length;) {
      const size = view.getUint32(offset + 4, true);
      if (tag(offset) === "data") {
        if (!format) throw new TypeError("Inworld WAV omitted its format");
        const currentFormat = format;
        const first = !this.format;
        if (this.format && (this.format.length !== currentFormat.length || this.format.some((byte, index) => byte !== currentFormat[index]))) throw new TypeError("Inworld changed WAV format between flushes");
        this.format = format; this.header = false; this.pending = new Uint8Array(0);
        if (!first) return data.subarray(offset + 8);
        view.setUint32(4, 0xffffffff, true); view.setUint32(offset + 4, 0xffffffff, true); return data;
      }
      if (offset + 8 + size > 1048576) throw new TypeError("Inworld WAV header is too large");
      if (offset + 8 + size > data.length) return new Uint8Array(0);
      if (tag(offset) === "fmt ") {
        if (size < 16 || view.getUint16(offset + 8, true) !== 1 || view.getUint16(offset + 22, true) !== 16
          || view.getUint16(offset + 10, true) === 0 || view.getUint16(offset + 20, true) !== view.getUint16(offset + 10, true) * 2) throw new TypeError("Inworld returned an invalid PCM WAV format");
        format = data.slice(offset + 8, offset + 8 + size);
      }
      offset += 8 + size + size % 2;
    }
    return new Uint8Array(0);
  }
}

function output(raw: unknown, timed: boolean, delivery: "chunk" | "trailing", correlationId: string | undefined, wave: WaveStream | undefined): Output | undefined {
  const packet = object(raw); status(packet.status);
  if (packet.audioContent === undefined && packet.timestampInfo === undefined && packet.usage === undefined) throw new TypeError("Inworld returned no audio or alignment");
  if (packet.audioContent !== undefined && typeof packet.audioContent !== "string") throw new TypeError("Inworld returned invalid audio content");
  const audio = packet.audioContent === undefined ? undefined : decodeBase64(packet.audioContent as string);
  const bytes = audio === undefined ? undefined : wave ? wave.audio(audio) : audio;
  const marks = timestamps(packet.timestampInfo);
  if (!timed) return bytes?.length ? bytes : undefined;
  if (bytes === undefined && packet.timestampInfo === undefined) return;
  const group = correlationId === undefined ? {} : { correlationId };
  if (delivery === "chunk") {
    if (bytes === undefined) throw new TypeError("Inworld omitted audio from synchronized alignment");
    return { correlation: "chunk", ...group, audio: bytes, timestamps: marks };
  }
  return { correlation: "timeline", ...group, ...(bytes === undefined ? {} : { audio: bytes }), timestamps: marks };
}

async function* bytes(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader(); const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  try { for (;;) { signal.throwIfAborted(); const item = await reader.read(); signal.throwIfAborted(); if (item.done) return; yield item.value; } }
  finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function responseText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  // Fetch strips one leading UTF-8 BOM; default TextDecoder behavior differs in Bun.
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true }); let text = "";
  for await (const chunk of bytes(response.body, signal)) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function* streaming(text: AsyncIterable<Input>, create: ContextSettings, socket: WebSocketLike, contextId: string, signal: AbortSignal,
  timed: boolean, delivery: "chunk" | "trailing", wave: WaveStream | undefined, validateInput: (value: unknown) => void): AsyncIterableIterator<Output> {
  const connection = await connectWebSocket({ socket, signal, encode: (message: Record<string, unknown>) => JSON.stringify({ ...message, contextId }), decode: data => {
    if (typeof data !== "string") throw new TypeError("Inworld returned a non-text WebSocket frame");
    return object(JSON.parse(data));
  } });
  let source: AsyncIterator<Input> | undefined; let inputDone = false; let stopped = false; let created = false; let flush = 0;
  const stopInput = () => {
    if (!source || inputDone || stopped) return; stopped = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  try {
    signal.throwIfAborted(); connection.send({ create }); source = text[Symbol.asyncIterator]();
    const nextInput = () => Promise.resolve().then(() => { signal.throwIfAborted(); return source!.next(); }).then(value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }));
    const nextOutput = () => connection.messages.next().then(value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }));
    let pendingInput = nextInput(); let pendingOutput = nextOutput(); let preferInput = false;
    for (;;) {
      const event = await (inputDone ? pendingOutput : Promise.race(preferInput ? [pendingInput, pendingOutput] : [pendingOutput, pendingInput]));
      signal.throwIfAborted(); preferInput = !preferInput;
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        if (event.value.done) { inputDone = true; connection.send({ close_context: {} }); }
        else {
          const value = event.value.value; validateInput(value);
          if (typeof value === "string") {
            // Item-level string annotations are not currently expressible in specgen.
            if (value.length > 2000) throw new TypeError("Inworld text chunks must not exceed 2000 characters");
            if (value) connection.send({ send_text: { text: value } });
          } else connection.send({ flush_context: {} });
          pendingInput = nextInput();
        }
      } else {
        if (event.value.done) throw new TypeError("Inworld WebSocket closed before contextClosed");
        const packet = event.value.value;
        if (packet.error !== undefined) { const error = object(packet.error); status(error); throw new InworldError(typeof error.message === "string" ? error.message : "Inworld synthesis failed", null, null); }
        const result = object(packet.result); status(result.status);
        if (result.contextId !== contextId) throw new TypeError("Inworld returned an unexpected context ID");
        const kinds = ["contextCreated", "audioChunk", "flushCompleted", "contextClosed"].filter(kind => result[kind] !== undefined);
        if (kinds.length !== 1) throw new TypeError("Inworld returned an invalid context event");
        object(result[kinds[0]!]);
        if (kinds[0] === "contextCreated") {
          if (created) throw new TypeError("Inworld returned duplicate contextCreated"); created = true;
        } else {
          if (!created) throw new TypeError("Inworld returned output before contextCreated");
          const correlationId = `${contextId}:${flush}`;
          if (kinds[0] === "audioChunk") { const value = output(result.audioChunk, timed, delivery, correlationId, wave); if (value !== undefined) yield value; }
          else if (kinds[0] === "flushCompleted") {
            wave?.boundary(); yield { event: "flush", correlationId, inputGroupId: String(flush) }; flush++;
          } else {
            if (!inputDone) throw new TypeError("Inworld completed before the input stream ended");
            wave?.boundary(); return;
          }
        }
        pendingOutput = nextOutput();
      }
    }
  } finally { signal.removeEventListener("abort", stopInput); stopInput(); connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  const validateInput = validateRequest(request);
  const socketMode = typeof request.text !== "string";
  if (!socketMode && (options.webSocket !== undefined || options.webSocketUrl !== undefined || options.contextId !== undefined)) throw new TypeError("Inworld WebSocket options require streaming input");
  if (socketMode && options.httpMode !== undefined) throw new TypeError("Inworld httpMode requires static text");
  const httpMode = options.httpMode ?? "stream";
  if (httpMode !== "single" && httpMode !== "stream") throw new TypeError("Invalid Inworld httpMode");
  if (httpMode === "single" && typeof request.text === "string" && request.text.length > 2000) throw new TypeError("Inworld single-response text must not exceed 2000 characters");
  if ((request.contextBefore?.texts.reduce((total, text) => total + text.length, 0) ?? 0) > 2000) throw new TypeError("Inworld preceding context must not exceed 2000 characters");
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Inworld timeoutMs must be an integer between 0 and 2147483647");
  const environment = typeof process === "undefined" ? {} : process.env;
  const token = options.auth?.inworld?.accessToken;
  const apiKey = options.auth?.inworld?.apiKey ?? environment.SPEECHSWITCH_INWORLD_API_KEY ?? environment.INWORLD_API_KEY;
  if (!token && !apiKey && !options.webSocket) throw new TypeError("Missing auth.inworld.apiKey configuration");
  const authorization = token ? `Bearer ${token}` : `Basic ${apiKey}`;
  const fetch = options.fetch ?? globalThis.fetch; const baseUrl = options.baseUrl ?? "https://api.inworld.ai";
  const contextId = socketMode ? options.contextId ?? globalThis.crypto.randomUUID() : "";
  if (socketMode && !contextId) throw new TypeError("Inworld contextId must not be empty");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("Inworld synthesis deadline expired", "TimeoutError");
  const delivery = request.timestampDelivery ?? requestDefaults.timestampDelivery; const timed = request.timestampGranularity !== undefined;
  const format = request.output.format;
  const settings = {
    voiceId: request.voice, modelId: request.model,
    audioConfig: { audioEncoding: { pcm: "PCM", wav: "WAV", mp3: "MP3", ogg_opus: "OGG_OPUS", mulaw: "MULAW", alaw: "ALAW", flac: "FLAC" }[format],
      sampleRateHertz: request.output.sampleRateHz ?? (format === "mulaw" || format === "alaw" ? 8000 : 48000),
      ...(format === "mp3" || format === "ogg_opus" ? { bitRate: request.output.bitRateBps ?? 128000 } : {}), speakingRate: request.speed ?? requestDefaults.speed },
    ...(request.model === "inworld-tts-2" ? { deliveryMode: { stable: "STABLE", balanced: "BALANCED", creative: "CREATIVE" }[request.deliveryMode ?? "balanced"] } : { temperature: request.temperature || 1 }),
    ...(request.language === undefined ? {} : { language: request.language }),
    applyTextNormalization: request.textNormalization === true ? "ON" : request.textNormalization === false ? "OFF" : "APPLY_TEXT_NORMALIZATION_UNSPECIFIED",
    timestampType: request.timestampGranularity === "word" ? "WORD" : request.timestampGranularity === "character" ? "CHARACTER" : "TIMESTAMP_TYPE_UNSPECIFIED",
  };
  let rejectAbort!: (reason: unknown) => void; const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timeout = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Inworld synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    if (typeof request.text !== "string") {
      let socket = options.webSocket;
      if (!socket) {
        const url = new URL(options.webSocketUrl ?? baseUrl);
        if (!options.webSocketUrl) { url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = `${url.pathname.replace(/\/$/, "")}/tts/v1/voice:streamBidirectional`; }
        if (token) socket = new globalThis.WebSocket(url.href, [`bearer_${token}`]);
        else {
          if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("Inworld native API-key WebSocket auth requires Node or Bun; supply an access token or authenticated socket in browsers");
          const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
          if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
          socket = new Constructor(url.href, { headers: { Authorization: authorization } });
        }
      }
      yield* streaming(request.text, { ...settings, timestampTransportStrategy: delivery === "chunk" ? "SYNC" : "ASYNC",
        maxBufferDelayMs: request.textFlushDelayMs ?? 0, bufferCharThreshold: request.textBufferThreshold || 1000, autoMode: request.automaticTextFlushing ?? false },
      socket, contextId, signal, timed, delivery, format === "wav" ? new WaveStream() : undefined, validateInput); return;
    }
    const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/$/, "")}/tts/v1/voice${httpMode === "stream" ? ":stream" : ""}`;
    const pending = fetch(url, { method: "POST", redirect: "error", headers: { Authorization: authorization, "content-type": "application/json" }, signal,
      body: JSON.stringify({ ...settings, text: request.text, ...(httpMode === "stream" ? { timestampTransportStrategy: delivery === "chunk" ? "SYNC" : "ASYNC" } : {}),
        ...(request.instructions === undefined ? {} : { instruction: request.instructions }), enhanceGeneration: request.audioEnhancement ?? false,
        ...(request.contextBefore === undefined ? {} : { synthesisContext: { previousRequests: request.contextBefore.texts.map(text => ({ text })) } }) }) });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    if (!response.ok) {
      const body = await Promise.race([responseText(response, signal), aborted]); signal.throwIfAborted();
      let code: number | null = null; let message = body;
      try { const error = JSON.parse(body); if (typeof error.message === "string") message = error.message; if (Number.isSafeInteger(error.code)) code = error.code; } catch {}
      throw new InworldError(message, response.status, code);
    }
    if (httpMode === "single") {
      const body = await Promise.race([responseText(response, signal), aborted]); signal.throwIfAborted();
      const packet = object(JSON.parse(body)); status(packet);
      if (typeof packet.audioContent !== "string") throw new TypeError("Inworld single response omitted audio");
      const value = output(packet, timed, "chunk", undefined, undefined); if (value !== undefined) yield value; return;
    }
    if (!response.body) throw new TypeError("Inworld returned no audio stream");
    const iterator = newlineDelimitedJson(bytes(response.body, signal))[Symbol.asyncIterator]();
    try {
      for (;;) {
        const item = await Promise.race([iterator.next(), aborted]); signal.throwIfAborted(); if (item.done) return;
        const packet = object(item.value);
        if (packet.error !== undefined) { const error = object(packet.error); status(error); throw new InworldError(typeof error.message === "string" ? error.message : "Inworld synthesis failed", null, null); }
        const value = output(packet.result, timed, delivery, undefined, undefined); if (value !== undefined) yield value;
      }
    } finally { try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch {} }
  } finally { if (timeout !== undefined) clearTimeout(timeout); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
