import type { TtsInput, TtsRequest, RimeEnvelope, RimeBatchEvent } from "../../../schemas/providers/rime/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64, encodeBase64 } from "../../base64.ts";
import type { ClearEvent, DoneEvent } from "../../dispatch.ts";
import { validateRequest, requestDefaults } from "../../generated/validators/rime.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsInput, RimeEnvelope, RimeBatchEvent } from "../../../schemas/providers/rime/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Exclusive, already-authenticated override, configured with this request's connection query. Closed when synthesis ends. */
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  /** Explicitly selects WebSocket even for whole text. Includes /ws3 (or the legacy /ws2 path). */
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
type Output = Uint8Array | RimeEnvelope | RimeBatchEvent | ClearEvent | DoneEvent;
type Packet =
  | { readonly type: "chunk"; readonly contextId: string | null; readonly audio: Uint8Array }
  | { readonly type: "timestamps"; readonly contextId: string | null; readonly timestamps: RimeEnvelope["timestamps"] }
  | { readonly type: "done"; readonly contextId: string | null }
  | { readonly type: "error"; readonly message: string };

export class RimeError extends Error {
  override readonly name = "RimeError";
  /** HTTP status for HTTP failures; absent for native WebSocket error events. */
  readonly status?: number;
  constructor(message: string, status?: number) { super(message); if (status !== undefined) this.status = status; }
}

function decode(data: unknown): Packet {
  if (typeof data !== "string") throw new TypeError("Rime returned a non-text WebSocket frame");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Rime response");
  const packet = value as Record<string, unknown>;
  if (packet.type === "error" && typeof packet.message === "string") return { type: "error", message: packet.message };
  if (packet.contextId !== null && typeof packet.contextId !== "string") throw new TypeError("Invalid Rime context ID");
  const contextId = packet.contextId;
  if (packet.type === "done") return { type: "done", contextId };
  if (packet.type === "chunk") {
    if (typeof packet.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(packet.data)) throw new TypeError("Invalid Rime audio response");
    const audio = decodeBase64(packet.data);
    if (encodeBase64(audio) !== packet.data) throw new TypeError("Invalid Rime audio response");
    return { type: "chunk", contextId, audio };
  }
  if (packet.type !== "timestamps" || !packet.word_timestamps || typeof packet.word_timestamps !== "object") throw new TypeError("Invalid Rime response");
  const marks = packet.word_timestamps as Record<string, unknown>;
  const { words, start, end } = marks;
  if (!Array.isArray(words) || !Array.isArray(start) || !Array.isArray(end) || words.length !== start.length || words.length !== end.length) throw new TypeError("Invalid Rime timestamp arrays");
  const timestamps = words.map((word: unknown, index) => {
    const from: unknown = start[index]; const to: unknown = end[index];
    if (typeof word !== "string" || typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from * 1000) || !Number.isFinite(to * 1000) || from < 0 || to < from) throw new TypeError("Invalid Rime timestamp interval");
    return { kind: "word" as const, value: word, startTimeMs: from * 1000, endTimeMs: to * 1000 };
  });
  return { type: "timestamps", contextId, timestamps };
}

async function* streaming(input: string | AsyncIterable<TtsInput>, socket: WebSocketLike, signal: AbortSignal,
  validateInput: (item: unknown) => void, timestamps: boolean): AsyncIterableIterator<Output> {
  let terminal: { readonly code: number; readonly clean: boolean } | undefined;
  let eosSent = false; let closedBeforeEos = false;
  const onClose = (event: unknown) => {
    closedBeforeEos = !eosSent;
    const close = event as { code?: unknown; wasClean?: unknown } | null;
    terminal = { code: typeof close?.code === "number" ? close.code : 1006, clean: close?.wasClean !== false };
  };
  socket.addEventListener("close", onClose);
  let source: AsyncIterator<TtsInput> | undefined; let sourceDone = false;
  const closeInput = () => {
    if (!source || sourceDone) return;
    sourceDone = true;
    // Uncooperative producers must not hold network cleanup hostage.
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", closeInput, { once: true });
  let connection: Awaited<ReturnType<typeof connectWebSocket<object, Packet>>> | undefined;
  try {
    connection = await connectWebSocket({ socket, signal, encode: (value: object) => JSON.stringify(value), decode });
    signal.throwIfAborted();
    source = typeof input === "string" ? (async function* () { yield input; })() : input[Symbol.asyncIterator]();
    const prefix = `${crypto.randomUUID()}:`; let generation = 0;
    const nextInput = () => Promise.resolve(source!.next()).then(item => ({ type: "input" as const, item }));
    const nextMessage = () => connection!.messages.next().then(item => ({ type: "message" as const, item }));
    let pendingInput = nextInput(); let pendingMessage = nextMessage(); let preferInput: boolean = true;
    void pendingInput.catch(() => {}); void pendingMessage.catch(() => {});
    for (;;) {
      const result: { type: "input"; item: IteratorResult<TtsInput> } | { type: "message"; item: IteratorResult<Packet> } = await Promise.race(sourceDone ? [pendingMessage] : preferInput ? [pendingInput, pendingMessage] : [pendingMessage, pendingInput]);
      signal.throwIfAborted(); preferInput = result.type !== "input";
      if (result.type === "input") {
        if (result.item.done) { sourceDone = true; eosSent = true; connection.send({ operation: "eos" }); continue; }
        const item = result.item.value;
        if (typeof input !== "string") validateInput(item);
        if (typeof item === "string") {
          // A stream's per-frame size is a protocol constraint, not its total text length.
          if (Array.from(item).length > 1000) throw new TypeError("Rime WebSocket text frames are limited to 1000 code points");
          if (item) connection.send({ text: item, contextId: `${prefix}${generation}` });
        } else if (item.command === "clear") {
          connection.send({ operation: "clear" }); generation++;
          // Native clear only drops buffered text. This event invalidates local
          // playback; later frames tagged with an older generation are discarded.
          yield { event: "clear" };
        } else connection.send({ operation: "flush" });
        signal.throwIfAborted(); pendingInput = nextInput(); void pendingInput.catch(() => {});
      } else {
        if (result.item.done) {
          if (closedBeforeEos || !eosSent || !terminal?.clean || (terminal.code !== 1000 && terminal.code !== 1005)) throw new TypeError("Rime WebSocket closed before clean end-of-stream");
          signal.throwIfAborted(); yield { event: "done" }; return;
        }
        const packet = result.item.value;
        pendingMessage = nextMessage(); void pendingMessage.catch(() => {});
        if (packet.type === "error") throw new RimeError(packet.message);
        const ordinal = packet.contextId?.startsWith(prefix) ? Number(packet.contextId.slice(prefix.length)) : NaN;
        if (Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < generation && packet.contextId === `${prefix}${ordinal}`) continue;
        if (generation > 0 && packet.contextId === null) throw new TypeError("Rime omitted context identity after clear; stale audio cannot be distinguished");
        const group = packet.contextId === null ? {} : { inputGroupId: packet.contextId };
        if (packet.type === "done") yield { event: "batch", ...group };
        else if (packet.type === "chunk") {
          if (packet.audio.byteLength) yield timestamps ? { correlation: "ordered", timestampOrigin: "synthesis", ...group, audio: packet.audio, timestamps: [] } : packet.audio;
        } else if (timestamps) yield { correlation: "ordered", timestampOrigin: "synthesis", ...group, timestamps: packet.timestamps };
      }
    }
  } finally {
    signal.removeEventListener("abort", closeInput); closeInput();
    socket.removeEventListener("close", onClose);
    connection?.close();
    if (!connection && socket.readyState < 2) socket.close();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  const validateInput = validateRequest(request);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.rime?.apiKey ?? environment.SPEECHSWITCH_RIME_API_KEY ?? environment.RIME_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.rime.apiKey configuration");
  const fetch = options.fetch ?? globalThis.fetch;
  const socketMode = typeof request.text !== "string" || request.timestampGranularity !== undefined || request.segmentation !== undefined || options.webSocket !== undefined || options.webSocketUrl !== undefined;
  const format = request.output?.format ?? "pcm";
  const legacy = request.model === "mist-v2";
  const sampleRateHz = request.output?.sampleRateHz ?? (legacy ? format === "mp3" ? 22050 : format === "mulaw" ? 8000 : 16000 : 24000);
  const language = request.language ?? "en";
  const timeScale = 1 / (request.speed ?? requestDefaults.speed);
  if (!Number.isFinite(timeScale)) throw new TypeError("Rime speed cannot be represented as a finite time scale");
  const inlineSpeedAlpha = request.textMarkup?.speeds?.map(speed => {
    const scale = 1 / speed;
    // Per-element numeric bounds are not expressible in the current schema annotations.
    if (speed <= 0 || !Number.isFinite(scale)) throw new TypeError("Rime inline speeds must have a positive finite reciprocal");
    return scale;
  }).join(",");
  const settings = {
    speaker: request.voice, modelId: request.model === "mist-v3" ? "mistv3" : legacy ? "mistv2" : "coda",
    lang: request.model === "mist-v2" ? { en: "eng", es: "spa", fr: "fra", de: "ger" }[request.language ?? "en"] : language,
    samplingRate: sampleRateHz,
    ...(legacy ? { speedAlpha: timeScale, noTextNormalization: !(request.textNormalization ?? true) } : { timeScaleFactor: timeScale }),
    ...(request.model === "coda" ? {} : { pauseBetweenBrackets: request.textMarkup?.pauses ?? false }),
    ...(legacy || (request.model === "mist-v3" && language === "en") ? { phonemizeBetweenBrackets: request.textMarkup?.phonemes ?? false } : {}),
    ...(inlineSpeedAlpha === undefined ? {} : { inlineSpeedAlpha }),
  };
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Rime timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("Rime synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Rime synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    if (socketMode) {
      let socket = options.webSocket;
      if (!socket) {
        if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("Rime native WebSocket auth requires Node or Bun; supply an authenticated socket or use HTTP in browsers");
        const url = new URL(options.webSocketUrl ?? "wss://users-ws.rime.ai/ws3");
        for (const [name, value] of Object.entries(settings)) url.searchParams.set(name, String(value));
        url.searchParams.set("audioFormat", format === "ogg_opus" ? "ogg" : format === "webm_opus" ? "webm" : format);
        url.searchParams.set("segment", request.segmentation === "manual" ? "never" : request.segmentation === "immediate" ? "immediate" : "bySentence");
        const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
        if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
        socket = new Constructor(url.href, { headers: { Authorization: `Bearer ${apiKey}` } });
      }
      yield* streaming(request.text, socket, signal, validateInput, request.timestampGranularity === "word"); return;
    }
    const url = new URL(options.baseUrl ?? "https://users.rime.ai"); url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/rime-tts`;
    const accept = { pcm: "audio/L16", wav: "audio/wav", mp3: "audio/mpeg", mulaw: "audio/PCMU", ogg_opus: "audio/ogg;codecs=opus", webm_opus: "audio/webm;codecs=opus" }[format];
    const pending = fetch(url, { method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: accept }, body: JSON.stringify({ ...settings, text: request.text }) });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new RimeError(`Rime returned HTTP ${response.status}`, response.status); }
    if (!response.body) throw new TypeError("Rime returned no audio body");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType && !contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
      void response.body.cancel().catch(() => {}); throw new TypeError("Rime returned an unexpected content type");
    }
    const reader = response.body.getReader(); let receivedAudio = false;
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted(); const item = await Promise.race([reader.read(), aborted]); signal.throwIfAborted();
        if (item.done) break;
        if (item.value.byteLength) { receivedAudio = true; yield item.value; }
      }
      if (!receivedAudio) throw new TypeError("Rime returned no audio");
      signal.throwIfAborted(); yield { event: "done" };
    } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  } finally { if (timer !== undefined) clearTimeout(timer); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
