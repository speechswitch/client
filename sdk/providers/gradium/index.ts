import type { TtsRequest, SynthesisItem } from "../../../schemas/providers/gradium/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import { requestDefaults, validateRequest } from "../../generated/validators/gradium.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { newlineDelimitedJson } from "../../runtime/ndjson.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, SynthesisItem } from "../../../schemas/providers/gradium/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Exclusive, authenticated socket for this operation; closed on completion. */
  readonly webSocket?: WebSocketLike;
  /** API root, including /api. Also used to derive the WebSocket endpoint. */
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
  /** Deadline for the entire operation, including input and transport waits. */
  readonly timeoutMs?: number;
  /** Server worker-allocation retry window. Does not retry synthesis; defaults to zero. WebSocket only. */
  readonly setupRetryMs?: number;
}

export class GradiumError extends Error {
  readonly statusCode: number | null;
  readonly code: number | null;
  constructor(message: string, statusCode: number | null, code: number | null) {
    super(message); this.name = "GradiumError"; this.statusCode = statusCode; this.code = code;
  }
}

// The OpenAPI omits json_config/model_name and all response schemas. Wire
// behavior comes from the unchanged REST and WebSocket protocol snapshots.
interface Settings {
  readonly model_name: "default" | "gradium-tts-beta";
  readonly voice_id: string;
  readonly output_format: string;
  readonly json_config: { readonly temp: number; readonly cfg_coef: number; readonly padding_bonus: number; readonly rewrite_rules?: string };
}
type Input = string | { readonly command: "flush" };
type ClientMessage = { readonly type: "setup"; readonly pronunciation_id?: string; readonly close_ws_on_eos: true; readonly retry_for_s: number } & Settings
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "end_of_stream" };
interface Timed { readonly start_s?: number; readonly stop_s?: number; readonly stream_id?: number }
type Packet = { readonly type: "ready"; readonly request_id: string }
  | ({ readonly type: "audio"; readonly audio: string } & Timed)
  | { readonly type: "text"; readonly text: string; readonly start_s: number; readonly stop_s: number; readonly stream_id?: number }
  | { readonly type: "end_of_stream" | "flushed" }
  | { readonly type: "error"; readonly message: string; readonly code?: number };

function decodePacket(value: unknown): Packet {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Gradium returned an invalid event");
  const message = value as Record<string, unknown>;
  // This operation owns a single non-multiplexed session. Never combine a
  // different logical request's audio merely because it arrived on this socket.
  if (message.client_req_id !== undefined) throw new TypeError("Gradium returned an unexpected multiplexed request ID");
  if (message.type === "ready" && typeof message.request_id === "string") return { type: "ready", request_id: message.request_id };
  if (message.type === "end_of_stream" || message.type === "flushed") return { type: message.type };
  if (message.type === "error" && typeof message.message === "string" && (message.code === undefined || (typeof message.code === "number" && Number.isSafeInteger(message.code)))) return message as unknown as Packet;
  if ((message.type === "audio" && typeof message.audio === "string") || (message.type === "text" && typeof message.text === "string")) {
    if (message.stream_id !== undefined && (typeof message.stream_id !== "number" || !Number.isSafeInteger(message.stream_id) || message.stream_id < 0)) throw new TypeError("Gradium returned an invalid stream ID");
    if (message.type === "text" || message.start_s !== undefined || message.stop_s !== undefined) {
      if (typeof message.start_s !== "number" || typeof message.stop_s !== "number" || !Number.isFinite(message.start_s * 1000) || !Number.isFinite(message.stop_s * 1000) || message.start_s < 0 || message.stop_s < message.start_s) throw new TypeError("Gradium returned an invalid time range");
    }
    return message as unknown as Packet;
  }
  throw new TypeError("Gradium returned an invalid event");
}

function output(packet: Packet, timestamps: boolean): SynthesisItem | undefined {
  if (packet.type === "error") throw new GradiumError(packet.message, null, packet.code ?? null);
  if (packet.type !== "audio" && packet.type !== "text") return;
  const correlationId = packet.stream_id === undefined ? {} : { correlationId: String(packet.stream_id) };
  if (packet.type === "audio") {
    const audio = decodeBase64(packet.audio);
    return timestamps ? { correlation: "timeline", ...correlationId, audio, timestamps: [],
      ...(packet.start_s === undefined ? {} : { audioTiming: { startTimeMs: packet.start_s * 1000, endTimeMs: packet.stop_s! * 1000 } }),
    } : audio;
  }
  if (timestamps) return { correlation: "timeline", ...correlationId, timestamps: [{ kind: "segment", value: packet.text, startTimeMs: packet.start_s * 1000, endTimeMs: packet.stop_s * 1000 }] };
}

async function* responseBytes(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    for (;;) {
      signal.throwIfAborted(); const item = await reader.read(); signal.throwIfAborted();
      if (item.done) return;
      yield item.value;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    // Cancellation must not depend on an injected source finishing its cleanup.
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

async function* streaming(text: string | AsyncIterable<Input>, settings: Settings, socket: WebSocketLike, signal: AbortSignal,
  timestamps: boolean, lexicon: string | undefined, setupRetryMs: number, validateInput: (value: unknown) => void): AsyncIterableIterator<SynthesisItem> {
  const connection = await connectWebSocket({ socket, signal, encode: (message: ClientMessage) => JSON.stringify(message), decode: data => {
    if (typeof data !== "string") throw new TypeError("Gradium returned a non-text WebSocket frame");
    return decodePacket(JSON.parse(data));
  } });
  let source: AsyncIterator<Input> | undefined; let inputDone = false; let stopped = false; let ready = false;
  const stopInput = () => {
    if (!source || inputDone || stopped) return; stopped = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  let pendingText = "";
  const sendText = (value: string) => { if (value) connection.send({ type: "text", text: value }); };
  const flushText = () => { sendText(pendingText); pendingText = ""; };
  try {
    signal.throwIfAborted();
    connection.send({ type: "setup", ...settings, pronunciation_id: lexicon, close_ws_on_eos: true, retry_for_s: setupRetryMs / 1000 });
    // Sending input need not wait for ready. Gradium explicitly supports this
    // lower-latency ordering; receive and validate ready concurrently.
    if (typeof text === "string") { sendText(text); connection.send({ type: "end_of_stream" }); inputDone = true; }
    else source = text[Symbol.asyncIterator]();
    const nextInput = () => Promise.resolve().then(() => { signal.throwIfAborted(); return source!.next(); }).then(value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }));
    const nextOutput = () => connection.messages.next().then(value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }));
    let pendingInput = source ? nextInput() : undefined; let pendingOutput = nextOutput(); let preferInput = false;
    for (;;) {
      const event = await (inputDone ? pendingOutput : Promise.race(preferInput ? [pendingInput!, pendingOutput] : [pendingOutput, pendingInput!]));
      signal.throwIfAborted(); preferInput = !preferInput;
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        if (event.value.done) { inputDone = true; flushText(); connection.send({ type: "end_of_stream" }); }
        else {
          const value = event.value.value; validateInput(value);
          if (typeof value !== "string") { sendText(`${pendingText} <flush>`); pendingText = ""; }
          else {
            pendingText += value;
            // Each native text message inserts a space. Retain unfinished words
            // and tags so token-sized input cannot change words or split markup.
            let inTag = false; let boundary = -1;
            for (let index = 0; index < pendingText.length; index++) {
              const character = pendingText[index]!;
              if (character === "<") inTag = true;
              else if (character === ">") { inTag = false; if (pendingText.slice(index - 6, index + 1) === "<flush>") boundary = index + 1; }
              else if (!inTag && /\s/.test(character)) boundary = index + 1;
            }
            if (boundary >= 0) {
              sendText(pendingText.slice(0, boundary).trimEnd()); pendingText = pendingText.slice(boundary);
            }
          }
          pendingInput = nextInput();
        }
      } else {
        if (event.value.done) throw new TypeError("Gradium WebSocket closed before end_of_stream");
        const packet = event.value.value;
        if (packet.type === "error") throw new GradiumError(packet.message, null, packet.code ?? null);
        if (packet.type === "ready") {
          if (ready) throw new TypeError("Gradium returned duplicate ready"); ready = true;
        } else {
          if (!ready) throw new TypeError("Gradium returned output before ready");
          if (packet.type === "end_of_stream") {
            if (!inputDone) throw new TypeError("Gradium completed before the input stream ended");
            return;
          }
          // TTS documents <flush>, but no correlation contract for flushed.
          // A reserved acknowledgement must not be invented as our flush event.
          const value = output(packet, timestamps); if (value !== undefined) yield value;
        }
        pendingOutput = nextOutput();
      }
    }
  } finally { signal.removeEventListener("abort", stopInput); stopInput(); connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<SynthesisItem> {
  const validateInput = validateRequest(request);
  const normalization = request.textNormalization;
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.gradium?.apiKey ?? environment.SPEECHSWITCH_GRADIUM_API_KEY ?? environment.GRADIUM_API_KEY;
  const token = options.auth?.gradium?.singleUseToken;
  const socketMode = typeof request.text !== "string" || request.lexicon !== undefined || options.webSocket !== undefined || token !== undefined || options.setupRetryMs !== undefined;
  if (!apiKey && !(socketMode && (options.webSocket || token))) throw new TypeError("Missing auth.gradium.apiKey configuration");
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://api.gradium.ai/api";
  const setupRetryMs = options.setupRetryMs ?? 0;
  if (!Number.isSafeInteger(setupRetryMs) || setupRetryMs < 0) throw new TypeError("Gradium setupRetryMs must be a non-negative safe integer");
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Gradium timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted();
  if (timeoutMs === 0) throw new DOMException("Gradium synthesis deadline expired", "TimeoutError");
  const format = request.output.format;
  const settings: Settings = {
    model_name: request.model ?? requestDefaults.model, voice_id: request.voice,
    output_format: format === "ogg_opus" ? "opus" : format === "mulaw" ? "ulaw_8000" : format === "alaw" ? "alaw_8000"
      : format === "pcm" ? `pcm_${request.output.sampleRateHz ?? 48000}` : "wav",
    json_config: { temp: request.temperature ?? requestDefaults.temperature, cfg_coef: request.voiceGuidance ?? requestDefaults.voiceGuidance, padding_bonus: request.pacingBias ?? requestDefaults.pacingBias,
      ...(normalization === false ? { rewrite_rules: "none" } : normalization && typeof normalization === "object" ? { rewrite_rules: normalization.locale ?? normalization.rules.join(",") } : {}),
    },
  };
  const timestamps = request.timestampGranularity !== undefined;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timeout = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Gradium synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    if (socketMode) {
      let socket = options.webSocket;
      if (!socket) {
        const url = new URL(options.webSocketUrl ?? baseUrl);
        if (!options.webSocketUrl) { url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = `${url.pathname.replace(/\/$/, "")}/speech/tts`; }
        if (token) { url.searchParams.set("token", token); socket = new globalThis.WebSocket(url.href); }
        else {
          if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("Gradium native WebSocket API-key auth requires Node or Bun; supply a single-use token or authenticated socket in browsers");
          const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
          if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
          socket = new Constructor(url.href, { headers: { "x-api-key": apiKey! } });
        }
      }
      yield* streaming(request.text, settings, socket, signal, timestamps, request.lexicon, setupRetryMs, validateInput); return;
    }
    const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/$/, "")}/post/speech/tts`;
    const pendingResponse = fetch(url, { method: "POST", redirect: "error", headers: { "x-api-key": apiKey!, "content-type": "application/json" },
      body: JSON.stringify({ ...settings, json_config: JSON.stringify(settings.json_config), text: request.text, only_audio: !timestamps }), signal });
    void pendingResponse.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pendingResponse, aborted]);
    if (!response.ok) {
      const decoder = new TextDecoder(); let body = "";
      if (response.body) for await (const chunk of responseBytes(response.body, signal)) body += decoder.decode(chunk, { stream: true });
      body += decoder.decode();
      const upstream = /^error from server (\d+): ([\s\S]*)$/.exec(body);
      const code = upstream ? Number(upstream[1]) : null;
      throw new GradiumError(upstream?.[2] ?? body, response.status, Number.isSafeInteger(code) ? code : null);
    }
    if (!response.body) throw new TypeError("Gradium returned no audio stream");
    const bytes = responseBytes(response.body, signal);
    const iterator = (timestamps ? newlineDelimitedJson(bytes) : bytes)[Symbol.asyncIterator]();
    let done = false;
    try {
      // HTTP EOF is completion per the POST contract; unlike WebSocket, an
      // explicit end_of_stream message is not required on this transport.
      for (;;) {
        const item = await Promise.race([iterator.next(), aborted]); signal.throwIfAborted();
        if (item.done) { done = true; break; }
        if (!timestamps) { yield item.value as Uint8Array; continue; }
        const packet = decodePacket(item.value);
        if (packet.type === "end_of_stream") return;
        const value = output(packet, true); if (value !== undefined) yield value;
      }
    } finally { if (!done) { try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch {} } }
    signal.throwIfAborted();
  } finally { if (timeout !== undefined) clearTimeout(timeout); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
