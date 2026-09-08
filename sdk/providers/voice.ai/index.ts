import type { TtsInput, TtsRequest, VoiceAiEnvelope } from "../../../schemas/providers/voice.ai/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64, encodeBase64 } from "../../base64.ts";
import type { ClearEvent, DoneEvent, FlushEvent } from "../../dispatch.ts";
import { validateRequest } from "../../generated/validators/voice.ai.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsInput, TtsRequest, VoiceAiEnvelope } from "../../../schemas/providers/voice.ai/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  /** Whole modern text defaults to byte-native HTTP streaming. Paced delivery and incremental input require WebSocket. */
  readonly transport?: "stream" | "http" | "websocket";
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Maximum JSON WebSocket frame size, default 4 MiB; raw HTTP audio is not capped. */
  readonly maxMessageBytes?: number;
}
type Output = Uint8Array | VoiceAiEnvelope | ClearEvent | FlushEvent | DoneEvent;
type ModernRequest = Exclude<TtsRequest, { readonly apiVersion: "tts-v2" }>;
type ServerMessage = { readonly kind: "audio"; readonly id: string; readonly audio: Uint8Array }
  | { readonly kind: "flush" | "closed"; readonly id: string }
  | { readonly kind: "error"; readonly id: string | null };

export class VoiceAiError extends Error {
  override readonly name = "VoiceAiError";
  readonly status: number | null;
  readonly contextId: string | null;
  constructor(status: number | null, contextId: string | null) {
    super(status === null ? "Voice.ai reported a synthesis error" : `Voice.ai returned HTTP ${status}`);
    this.status = status; this.contextId = contextId;
  }
}

function audioFormat(output: ModernRequest["output"]): string {
  if (!output) return "mp3";
  switch (output.format) {
    case "pcm": return `pcm_${output.sampleRateHz ?? 32000}`;
    case "wav": return output.sampleRateHz === undefined || output.sampleRateHz === 32000 ? "wav" : `wav_${output.sampleRateHz}`;
    case "mulaw": return "ulaw_8000";
    case "alaw": return "alaw_8000";
    case "opus": return `opus_48000_${output.bitRateBps / 1000}`;
    case "mp3":
      if (output.sampleRateHz === undefined || output.sampleRateHz === 32000) return "mp3";
      return `mp3_${output.sampleRateHz}_${(output.bitRateBps ?? (output.sampleRateHz === 22050 ? 32000 : 48000)) / 1000}`;
  }
}

function settings(request: ModernRequest) {
  const language = request.language ?? "en";
  const dictionary = request.pronunciationDictionaries?.[0];
  return {
    ...(request.voice === undefined ? {} : { voice_id: request.voice }),
    model: request.model === undefined || request.model === "auto"
      ? language === "en" ? "voiceai-tts-v1-latest" : "voiceai-tts-multilingual-v1-latest" : request.model,
    language, audio_format: audioFormat(request.output), temperature: request.temperature ?? 1, top_p: request.topP ?? 0.8,
    ...(dictionary === undefined ? {} : { dictionary_id: dictionary.id, ...(dictionary.version === undefined ? {} : { dictionary_version: dictionary.version }) }),
  };
}

function decode(data: unknown, maxMessageBytes: number): ServerMessage {
  if (typeof data !== "string") throw new TypeError("Voice.ai expected a JSON text frame");
  if (data.length > maxMessageBytes || new TextEncoder().encode(data).byteLength > maxMessageBytes) throw new TypeError("Voice.ai message exceeds maxMessageBytes");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Voice.ai message");
  const message = value as Record<string, unknown>;
  const kinds = ["audio", "is_last", "context_closed", "error"].filter(key => Object.hasOwn(message, key));
  if (kinds.length !== 1) throw new TypeError("Invalid Voice.ai message variant");
  const id = message.context_id;
  if (kinds[0] === "error") {
    if (typeof message.error !== "string" || id !== undefined && id !== null && typeof id !== "string") throw new TypeError("Invalid Voice.ai error message");
    return { kind: "error", id: typeof id === "string" ? id : null };
  }
  if (typeof id !== "string" || !id) throw new TypeError("Voice.ai omitted context_id");
  if (kinds[0] === "audio") {
    if (typeof message.audio !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.audio)) throw new TypeError("Invalid Voice.ai base64 audio");
    const audio = decodeBase64(message.audio);
    if (encodeBase64(audio) !== message.audio) throw new TypeError("Invalid Voice.ai base64 audio");
    return { kind: "audio", id, audio };
  }
  if (message[kinds[0]!] !== true) throw new TypeError("Invalid Voice.ai completion flag");
  return { kind: kinds[0] === "is_last" ? "flush" : "closed", id };
}

async function* bytes(body: ReadableStream<Uint8Array>, signal: AbortSignal, aborted: Promise<never>): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const item = await Promise.race([reader.read(), aborted]);
      signal.throwIfAborted();
      if (item.done) return;
      if (item.value.byteLength) yield item.value;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function* socketStream(text: ModernRequest["text"], config: ReturnType<typeof settings> & { readonly delivery_mode: "raw" | "paced" }, socket: WebSocketLike, signal: AbortSignal, aborted: Promise<never>, maxMessageBytes: number, validateInput: (item: unknown) => void): AsyncIterableIterator<VoiceAiEnvelope | ClearEvent | FlushEvent> {
  const connection = await connectWebSocket({ socket, signal, encode: (message: object) => JSON.stringify(message), decode: data => decode(data, maxMessageBytes) });
  let source: AsyncIterator<TtsInput> | undefined;
  let inputDone = false;
  let inputReleased = false;
  const releaseInput = () => {
    if (inputReleased || inputDone || !source) return;
    inputReleased = true;
    // return may wait behind an uncooperative next; never await it.
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", releaseInput, { once: true });
  const contexts = new Map<string, { flushing: boolean; cleared: boolean; audio: boolean; finished: boolean }>();
  let retiredThrough = 0;
  const clears: Set<string>[] = [];
  let current: string | undefined;
  let sequence = 0;
  function flush() {
    if (!current) return;
    const context = contexts.get(current)!;
    context.flushing = true;
    connection.send({ context_id: current, text: "", flush: true, auto_close: true });
    current = undefined;
  }
  try {
    const prefix = crypto.randomUUID();
    source = typeof text === "string" ? (async function* () { yield text; })()[Symbol.asyncIterator]() : text[Symbol.asyncIterator]();
    if (signal.aborted) releaseInput();
    signal.throwIfAborted();
    const nextInput = () => Promise.resolve().then(() => source!.next()).then(item => ({ kind: "input" as const, item }), error => ({ kind: "failure" as const, error }));
    const nextMessage = () => connection.messages.next().then(item => ({ kind: "message" as const, item }), error => ({ kind: "failure" as const, error }));
    let input = nextInput();
    let message = nextMessage();
    for (;;) {
      signal.throwIfAborted();
      while (clears[0]?.size === 0) { clears.shift(); yield { event: "clear" }; signal.throwIfAborted(); }
      if (inputDone && contexts.size === 0) return;
      const result = await Promise.race(inputDone ? [message, aborted] : [message, input, aborted]);
      signal.throwIfAborted();
      if (result.kind === "failure") throw result.error;
      if (result.kind === "input") {
        if (result.item.done) { inputDone = true; flush(); continue; }
        const part = result.item.value;
        validateInput(part);
        if (typeof part === "string") {
          if (part.length) {
            if (!current) {
              current = `${prefix}:${++sequence}`;
              contexts.set(current, { flushing: false, cleared: false, audio: false, finished: false });
              connection.send({ ...config, context_id: current, text: part });
            } else connection.send({ context_id: current, text: part });
          }
        } else if (part.command === "flush") flush();
        else {
          retiredThrough = sequence;
          const pending = new Set(contexts.keys());
          clears.push(pending);
          for (const [id, context] of contexts) {
            if (context.cleared) continue;
            context.cleared = true;
            // Flushing contexts already have auto_close. Sending a second close
            // could race the native closure and target a nonexistent context.
            if (!context.flushing) connection.send({ context_id: id, close_context: true });
          }
          current = undefined;
        }
        input = nextInput();
        continue;
      }
      if (result.item.done) throw new TypeError("Voice.ai closed before input and contexts completed");
      const event = result.item.value;
      if (event.kind === "error") throw new VoiceAiError(null, event.id);
      const context = contexts.get(event.id);
      if (!context) {
        const suffix = event.id.startsWith(`${prefix}:`) ? event.id.slice(prefix.length + 1) : "";
        const ordinal = Number(suffix);
        // Every context before the clear watermark is retired. No unbounded
        // history of cleared IDs is needed for long-lived conversations.
        if (String(ordinal) === suffix && Number.isSafeInteger(ordinal) && ordinal > 0 && ordinal <= retiredThrough) { message = nextMessage(); continue; }
        throw new TypeError("Voice.ai returned an unknown or completed context");
      }
      if (event.kind === "audio") {
        if (!context.cleared) {
          if (!context.flushing || context.finished) throw new TypeError("Voice.ai audio arrived outside an active flush");
          if (event.audio.byteLength) {
            context.audio = true;
            yield { correlation: "ordered", correlationId: event.id, audio: event.audio, timestamps: [] };
          }
        }
      } else if (event.kind === "flush") {
        if (!context.cleared) {
          if (!context.flushing || context.finished || !context.audio) throw new TypeError("Voice.ai returned an unexpected or empty flush completion");
          context.finished = true;
          yield { event: "flush", correlationId: event.id };
        }
      } else {
        if (!context.cleared && !context.finished) throw new TypeError("Voice.ai context closed before flush completion");
        contexts.delete(event.id);
        for (const pending of clears) pending.delete(event.id);
      }
      message = nextMessage();
    }
  } finally {
    connection.close();
    signal.removeEventListener("abort", releaseInput);
    releaseInput();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  const validateInput = validateRequest(request);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.["voice.ai"]?.apiKey ?? environment.SPEECHSWITCH_VOICE_AI_API_KEY ?? environment.VOICE_AI_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.voice.ai.apiKey configuration");
  const legacy = request.apiVersion === "tts-v2";
  const requiresSocket = !legacy && (typeof request.text !== "string" || request.audioDelivery === "paced");
  const transport = options.transport ?? (requiresSocket || options.webSocket ? "websocket" : "stream");
  if (!["stream", "http", "websocket"].includes(transport)) throw new TypeError("Invalid Voice.ai transport");
  if (requiresSocket && transport !== "websocket") throw new TypeError("Voice.ai incremental input and paced delivery require WebSocket");
  if (options.webSocket && transport !== "websocket") throw new TypeError("Voice.ai webSocket override requires WebSocket transport");
  const maxMessageBytes = options.maxMessageBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0) throw new TypeError("Voice.ai maxMessageBytes must be a positive safe integer");
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0 || options.timeoutMs > 2147483647)) throw new TypeError("Voice.ai timeoutMs must be between 0 and 2147483647");
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(signal.reason); });
  void aborted.catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  if (options.timeoutMs === 0) lifetime.abort(new DOMException("Voice.ai synthesis timed out", "TimeoutError"));
  else if (options.timeoutMs !== undefined) timer = setTimeout(() => lifetime.abort(new DOMException("Voice.ai synthesis timed out", "TimeoutError")), options.timeoutMs);
  try {
    signal.throwIfAborted();
    const url = new URL(options.baseUrl ?? (legacy ? "https://api.voice.ai" : "https://dev.voice.ai"));
    if (url.username || url.password || url.search || url.hash || !["https:", "http:", "wss:", "ws:"].includes(url.protocol)) throw new TypeError("Voice.ai baseUrl must be an HTTP or WebSocket base without credentials, query or fragment");
    if (transport === "websocket") {
      if (request.apiVersion === "tts-v2") throw new TypeError("Voice.ai legacy API does not document WebSocket synthesis");
      const text = request.text;
      const params = settings(request);
      const deliveryMode = request.audioDelivery === "paced" ? "paced" : "raw";
      url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
      url.pathname = `${url.pathname.replace(/\/$/, "")}/api/v1/tts/multi-stream`;
      let socket = options.webSocket;
      if (!socket) {
        if (typeof Bun === "undefined" && (typeof process === "undefined" || !process.versions?.node)) throw new TypeError("Voice.ai native socket auth requires Node/Bun, a backend proxy or an authenticated webSocket override");
        const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { readonly headers: Readonly<Record<string, string>> }) => WebSocketLike;
        if (!Constructor) throw new TypeError("Voice.ai requires a native WebSocket or an injected webSocket");
        socket = new Constructor(url.href, { headers: { Authorization: `Bearer ${apiKey}` } });
      }
      yield* socketStream(text, { ...params, delivery_mode: deliveryMode }, socket, signal, aborted, maxMessageBytes, validateInput);
    } else {
      url.protocol = url.protocol === "ws:" || url.protocol === "http:" ? "http:" : "https:";
      url.pathname = `${url.pathname.replace(/\/$/, "")}${legacy ? "/tts/v2/audio/speech" : `/api/v1/tts/speech${transport === "stream" ? "/stream" : ""}`}`;
      const payload = request.apiVersion === "tts-v2" ? {
        text: request.text, voice: request.voice, audio_format: request.output?.format ?? "mp3", streaming: transport === "stream",
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }), ...(request.topP === undefined ? {} : { top_p: request.topP }),
      } : { ...settings(request), text: request.text };
      const fetch = options.fetch ?? globalThis.fetch;
      const pending = fetch(url, { method: "POST", redirect: "error", signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "audio/*, application/octet-stream" }, body: JSON.stringify(payload) });
      void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
      const response = await Promise.race([pending, aborted]);
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new VoiceAiError(response.status, null); }
      if (!response.body) throw new TypeError("Voice.ai returned no audio body");
      const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (type && !type.startsWith("audio/") && type !== "application/octet-stream") {
        void response.body.cancel().catch(() => {}); throw new TypeError("Voice.ai returned an unexpected audio content type");
      }
      let audio = false;
      for await (const chunk of bytes(response.body, signal, aborted)) { audio = true; yield chunk; }
      if (!audio) throw new TypeError("Voice.ai returned no audio bytes");
    }
    signal.throwIfAborted();
    yield { event: "done" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    lifetime.abort(new DOMException("Voice.ai synthesis closed", "AbortError"));
  }
}
