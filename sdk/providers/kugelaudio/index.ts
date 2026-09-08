import type { TtsRequest, UpdateCommand } from "../../../schemas/providers/kugelaudio/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { ClearEvent, UpdatedEvent } from "../../dispatch.ts";
import { requestDefaults, validateRequest } from "../../generated/validators/kugelaudio.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, UpdateCommand } from "../../../schemas/providers/kugelaudio/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Exclusive, already-authenticated socket; closed when synthesis ends. */
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly region?: "eu" | "global";
  readonly signal?: AbortSignal;
  /** Whole-operation deadline, including input, connection, and response waits. */
  readonly timeoutMs?: number;
  readonly onWarning?: (warning: string) => void;
}
export interface KugelAudioTimestamp extends Timestamp<"word"> {
  /** Native alignment confidence; currently a compatibility value. */
  readonly confidence?: number;
}
export interface KugelAudioEnvelope {
  readonly correlation: "ordered";
  /** Turn ordinal plus native chunk_id; time and character offsets restart in this group. */
  readonly correlationId: string;
  readonly inputGroupId: string;
  readonly chunkId: number;
  readonly audio?: Uint8Array;
  readonly audioTiming?: { readonly startTimeMs: number; readonly endTimeMs: number };
  readonly timestamps: readonly KugelAudioTimestamp[];
}
export interface KugelAudioUsage {
  readonly audioSeconds: number;
  readonly characters: number;
  /** Null means unavailable, not free. */
  readonly costCents: number | null;
  readonly currency?: "eur";
  readonly model?: string;
}
export interface KugelAudioTurnEvent {
  readonly event: "flush";
  readonly correlationId: string;
  readonly inputGroupId: string;
  readonly usage?: KugelAudioUsage;
}
export interface KugelAudioDoneEvent { readonly event: "done"; readonly usage?: KugelAudioUsage }
type Output = Uint8Array | KugelAudioEnvelope | ClearEvent | UpdatedEvent | KugelAudioTurnEvent | KugelAudioDoneEvent;
type Input = string | { readonly command: "clear" } | { readonly command: "flush" } | UpdateCommand;
interface Configuration {
  readonly voice_id: string | number;
  readonly model_id: string;
  readonly cfg_scale: number;
  readonly temperature?: number;
  readonly max_new_tokens: number;
  readonly sample_rate: number;
  readonly output_format?: string;
  readonly normalize: boolean;
  readonly language?: string;
  readonly speed: number;
  readonly project_id?: number;
  readonly dictionary_ids?: readonly number[];
}
export class KugelAudioError extends Error {
  readonly statusCode: number | null;
  readonly code: string | null;
  readonly retryAfter: string | null;
  constructor(message: string, statusCode: number | null, code: string | null, retryAfter: string | null = null) {
    super(message); this.name = "KugelAudioError"; this.statusCode = statusCode; this.code = code; this.retryAfter = retryAfter;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("KugelAudio returned an invalid object");
  return value as Record<string, unknown>;
}
function number(value: unknown, field: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw new TypeError(`KugelAudio returned invalid ${field}`);
  return value;
}
function usage(raw: unknown): KugelAudioUsage | undefined {
  if (raw === undefined) return;
  const value = object(raw);
  if (value.currency !== undefined && value.currency !== "eur") throw new TypeError("KugelAudio returned an invalid usage currency");
  if (value.model_id !== undefined && typeof value.model_id !== "string") throw new TypeError("KugelAudio returned an invalid usage model");
  if (value.cost_cents === null && value.cost_unavailable !== true) throw new TypeError("KugelAudio omitted its cost-unavailable indicator");
  return { audioSeconds: number(value.audio_seconds, "usage audio_seconds"), characters: number(value.characters, "usage characters", true),
    costCents: value.cost_cents === null ? null : number(value.cost_cents, "usage cost_cents"),
    ...(value.currency === undefined ? {} : { currency: value.currency }), ...(value.model_id === undefined ? {} : { model: value.model_id as string }) };
}
function updated(raw: unknown): UpdatedEvent {
  const value = object(raw);
  if (value.language !== undefined && typeof value.language !== "string") throw new TypeError("KugelAudio returned invalid settings language");
  if (value.normalize !== undefined && typeof value.normalize !== "boolean") throw new TypeError("KugelAudio returned invalid settings normalize");
  return { event: "updated",
    ...(value.cfg_scale === undefined ? {} : { voiceGuidance: number(value.cfg_scale, "settings cfg_scale") }),
    ...(value.temperature === undefined ? {} : { temperature: number(value.temperature, "settings temperature") }),
    ...(value.max_new_tokens === undefined ? {} : { maxAudioTokens: number(value.max_new_tokens, "settings max_new_tokens", true) }),
    ...(value.speed === undefined ? {} : { speed: number(value.speed, "settings speed") }),
    ...(value.language === undefined ? {} : { language: value.language as string }),
    ...(value.normalize === undefined ? {} : { textNormalization: value.normalize as boolean }) };
}
function alignment(raw: unknown): KugelAudioTimestamp[] {
  if (!Array.isArray(raw)) throw new TypeError("KugelAudio returned invalid word timestamps");
  return raw.map(item => {
    const word = object(item);
    if (typeof word.word !== "string") throw new TypeError("KugelAudio returned an invalid word");
    const startTimeMs = number(word.start_ms, "start_ms"); const endTimeMs = number(word.end_ms, "end_ms");
    const start = number(word.char_start, "char_start", true); const end = number(word.char_end, "char_end", true);
    if (endTimeMs < startTimeMs || end < start) throw new TypeError("KugelAudio returned reversed alignment bounds");
    return { kind: "word", value: word.word, startTimeMs, endTimeMs, source: { start, end },
      ...(word.score === undefined ? {} : { confidence: number(word.score, "score") }) };
  });
}

async function* bytes(body: ReadableStream<Uint8Array>, signal: AbortSignal, aborted: Promise<never>): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const item = await Promise.race([reader.read(), aborted]); signal.throwIfAborted(); if (item.done) return; yield item.value; }
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function* streaming(text: string | AsyncIterable<Input>, configuration: Configuration, request: TtsRequest,
  socket: WebSocketLike, signal: AbortSignal, onWarning: (message: string) => void, validateInput: (value: unknown) => void): AsyncIterableIterator<Output> {
  const live = typeof text !== "string"; const timed = request.timestampGranularity !== undefined;
  const connection = await connectWebSocket({ socket, signal, encode: (value: Record<string, unknown>) => JSON.stringify(value), decode: data => {
    if (typeof data !== "string") throw new TypeError("KugelAudio returned a non-text WebSocket frame");
    return object(JSON.parse(data));
  } });
  let source: AsyncIterator<Input> | undefined; let inputDone = !live; let stopped = false;
  let state: "idle" | "active" | "flushing" | "clearing" = live ? "idle" : "active";
  let turn = 0; let finalSeen = false; let updates = 0;
  const samples = new Map<number, number>();
  const stopInput = () => {
    if (!source || inputDone || stopped) return; stopped = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  try {
    signal.throwIfAborted();
    connection.send({ ...configuration, word_timestamps: timed, speaker_prefix: request.voiceBoost ?? true,
      ...(live ? { flush_timeout_ms: request.textFlushDelayMs ?? 500, max_buffer_length: request.textBufferThreshold ?? 10000 } : { text }) });
    if (typeof text !== "string") source = text[Symbol.asyncIterator]();
    const nextInput = () => Promise.resolve().then(() => { signal.throwIfAborted(); return source!.next(); }).then(value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }));
    const nextOutput = () => connection.messages.next().then(value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }));
    let pendingInput = live ? nextInput() : undefined; let pendingOutput = nextOutput();
    let held: IteratorResult<Input> | undefined; let preferInput = false;
    for (;;) {
      signal.throwIfAborted();
      if (live && inputDone && state === "idle" && updates === 0) { connection.send({ close_socket: true }); return; }
      // One-item lookahead bounds buffering while a turn drains. Clear remains
      // actionable during a flush; text waits for the native end-of-turn ack.
      if (held && (held.done || state === "idle" || state === "active" || (state !== "clearing" && typeof held.value !== "string" && held.value.command !== "flush"))) {
        const item = held; held = undefined;
        if (item.done) {
          inputDone = true;
          if (state === "active") { connection.send({ flush: true }); state = "flushing"; }
        } else {
          const value = item.value;
          if (typeof value === "string") {
            // Collection-element length annotations are not yet expressible in specgen.
            if (value.length > 10000) throw new TypeError("KugelAudio text fragments must not exceed 10000 characters");
            if (value) { connection.send({ text: value }); state = "active"; }
          } else if (value.command === "clear") { connection.send({ cancel: true }); state = "clearing"; }
          else if (value.command === "flush") { if (state === "active") { connection.send({ flush: true }); state = "flushing"; } }
          else {
            connection.send({ update_settings: {
              ...(value.voiceGuidance === undefined ? {} : { cfg_scale: value.voiceGuidance }),
              ...(value.temperature === undefined ? {} : { temperature: value.temperature }),
              ...(value.maxAudioTokens === undefined ? {} : { max_new_tokens: value.maxAudioTokens }),
              ...(value.language === undefined ? {} : { language: value.language }),
              ...(value.textNormalization === undefined ? {} : { normalize: value.textNormalization }),
              ...(value.speed === undefined ? {} : { speed: value.speed }),
            } }); updates++;
          }
          pendingInput = nextInput();
        }
        if (inputDone && state === "idle" && updates === 0) continue;
      }
      const event: Awaited<ReturnType<typeof nextInput> | ReturnType<typeof nextOutput>> = await (pendingInput ? Promise.race(preferInput ? [pendingInput, pendingOutput] : [pendingOutput, pendingInput]) : pendingOutput);
      preferInput = !preferInput; signal.throwIfAborted();
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") { if (!event.value.done) validateInput(event.value.value); held = event.value; pendingInput = undefined; continue; }
      if (event.value.done) throw new TypeError("KugelAudio WebSocket closed before synthesis completed");
      const packet: Record<string, unknown> = event.value.value;
      const kinds = ["error", "audio", "word_timestamps", "generation_started", "chunk_complete", "interrupted", "settings_updated", "warning", "final", "session_closed"].filter(key => packet[key] !== undefined);
      if (kinds.length !== 1) throw new TypeError("KugelAudio returned an invalid event");
      const kind = kinds[0]!;
      if (["generation_started", "chunk_complete", "interrupted", "settings_updated", "final", "session_closed"].includes(kind) && packet[kind] !== true) throw new TypeError("KugelAudio returned an invalid event flag");
      if (kind === "error") {
        if (typeof packet.error !== "string" || typeof packet.error_code !== "string") throw new TypeError("KugelAudio returned an invalid error");
        throw new KugelAudioError(packet.error, number(packet.code, "error code", true), packet.error_code);
      } else if (kind === "warning") {
        if (typeof packet.warning !== "string") throw new TypeError("KugelAudio returned an invalid warning"); onWarning(packet.warning);
      } else if (kind === "settings_updated") {
        if (updates === 0) throw new TypeError("KugelAudio returned an unsolicited settings acknowledgement");
        updates--; yield updated(packet.settings);
      } else if (kind === "interrupted") {
        if (state !== "clearing") throw new TypeError("KugelAudio returned an unsolicited interruption");
        state = "idle"; finalSeen = false; samples.clear(); turn++; yield { event: "clear" };
      } else if (state !== "clearing") {
        if (kind === "final") {
          if (state === "idle" || finalSeen) throw new TypeError("KugelAudio returned an unexpected final");
          if (!live) { const value = usage(packet.usage); yield { event: "done", ...(value === undefined ? {} : { usage: value }) }; return; }
          finalSeen = true; state = "flushing";
        } else if (kind === "session_closed") {
          if (!live || !finalSeen) throw new TypeError("KugelAudio ended a turn before final");
          const value = usage(packet.usage);
          yield { event: "flush", correlationId: String(turn), inputGroupId: String(turn), ...(value === undefined ? {} : { usage: value }) };
          state = "idle"; finalSeen = false; samples.clear(); turn++;
        } else {
          if (state === "idle" || finalSeen) throw new TypeError("KugelAudio returned output outside an active turn");
          const chunkId = number(packet.chunk_id, "chunk_id", true);
          const group = { correlation: "ordered" as const, correlationId: `${turn}:${chunkId}`, inputGroupId: String(turn), chunkId };
          if (kind === "audio") {
            const expectedEncoding = configuration.output_format === "ulaw_8000" ? "mulaw" : configuration.output_format === "alaw_8000" ? "alaw" : "pcm_s16le";
            if (typeof packet.audio !== "string" || packet.enc !== expectedEncoding || packet.sr !== configuration.sample_rate) throw new TypeError("KugelAudio returned an unexpected audio format");
            number(packet.idx, "idx", true); const count = number(packet.samples, "samples", true); const audio = decodeBase64(packet.audio);
            if (audio.length !== count * (expectedEncoding === "pcm_s16le" ? 2 : 1)) throw new TypeError("KugelAudio audio size disagrees with its sample count");
            const start = samples.get(chunkId) ?? 0; const end = start + count;
            if (!Number.isSafeInteger(end)) throw new TypeError("KugelAudio audio sample count overflow"); samples.set(chunkId, end);
            if (timed) yield { ...group, audio, audioTiming: { startTimeMs: start / configuration.sample_rate * 1000, endTimeMs: end / configuration.sample_rate * 1000 }, timestamps: [] };
            else yield audio;
          } else if (kind === "word_timestamps") {
            const timestamps = alignment(packet.word_timestamps);
            if (!timed) throw new TypeError("KugelAudio returned unrequested timestamps");
            yield { ...group, timestamps };
          } else if (kind === "generation_started") {
            if (typeof packet.text !== "string") throw new TypeError("KugelAudio returned invalid generated text");
          } else { number(packet.audio_seconds, "audio_seconds"); number(packet.gen_ms, "gen_ms"); }
        }
      }
      pendingOutput = nextOutput();
    }
  } finally { signal.removeEventListener("abort", stopInput); stopInput(); connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  const validateInput = validateRequest(request);
  const live = typeof request.text !== "string";
  const socketMode = live || request.timestampGranularity !== undefined || request.voiceBoost !== undefined || options.webSocket !== undefined || options.webSocketUrl !== undefined;
  if (typeof request.voice === "number" ? !Number.isSafeInteger(request.voice) : !request.voice.trim()) throw new TypeError("KugelAudio voice must be a nonempty handle or an integer ID");
  // Element annotations and constraints on mixed scalar alternatives are not supported.
  for (const value of request.pronunciationDictionarySelection?.ids ?? []) {
    if (!Number.isSafeInteger(value)) throw new TypeError("KugelAudio dictionary IDs must be integers");
  }
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("KugelAudio timeoutMs must be an integer between 0 and 2147483647");
  if (options.region !== undefined && options.region !== "eu" && options.region !== "global") throw new TypeError("Invalid KugelAudio region");
  const environment = typeof process === "undefined" ? {} : process.env;
  const key = options.auth?.kugelaudio?.apiKey ?? environment.SPEECHSWITCH_KUGELAUDIO_API_KEY ?? environment.KUGELAUDIO_API_KEY ?? "";
  const eu = key.startsWith("eu-"); const apiKey = eu ? key.slice(3) : key;
  if (!apiKey && !options.webSocket) throw new TypeError("Missing auth.kugelaudio.apiKey configuration");
  const baseUrl = options.baseUrl ?? ((options.region ?? (eu ? "eu" : "global")) === "eu" ? "https://api.eu.kugelaudio.com" : "https://api.kugelaudio.com");
  const fetch = options.fetch ?? globalThis.fetch;
  const format = request.output.format; const sampleRate = request.output.sampleRateHz ?? (format === "pcm" ? 24000 : 8000);
  const configuration: Configuration = {
    voice_id: request.voice, model_id: request.model ?? requestDefaults.model, cfg_scale: request.voiceGuidance ?? requestDefaults.voiceGuidance,
    ...(request.temperature === undefined ? (live ? {} : { temperature: 0.4 }) : { temperature: request.temperature }),
    max_new_tokens: request.maxAudioTokens ?? requestDefaults.maxAudioTokens, sample_rate: sampleRate,
    // The native token catalog has no pcm_44100; legacy sample_rate supports it.
    ...(format === "pcm" ? {} : { output_format: format === "mulaw" ? "ulaw_8000" : "alaw_8000" }),
    normalize: request.textNormalization ?? requestDefaults.textNormalization, speed: request.speed ?? requestDefaults.speed,
    ...(request.language === undefined ? {} : { language: request.language }),
    ...(request.pronunciationDictionarySelection === undefined ? {} : { project_id: request.pronunciationDictionarySelection.scope,
      ...(request.pronunciationDictionarySelection.ids === undefined ? {} : { dictionary_ids: request.pronunciationDictionarySelection.ids }) }),
  };
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("KugelAudio synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void; const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timeout = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("KugelAudio synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    if (socketMode) {
      let socket = options.webSocket;
      if (!socket) {
        if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("KugelAudio native WebSocket auth requires Node or Bun; supply an authenticated socket in browsers");
        const url = new URL(options.webSocketUrl ?? baseUrl);
        if (!options.webSocketUrl) { url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/tts${live ? "/stream" : ""}`; }
        const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
        if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
        socket = new Constructor(url.href, { headers: { Authorization: `Bearer ${apiKey}` } });
      }
      yield* streaming(request.text, configuration, request, socket, signal, options.onWarning ?? (() => {}), validateInput); return;
    }
    const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/tts/generate`;
    const pending = fetch(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, signal,
      body: JSON.stringify({ ...configuration, text: request.text }) });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    try {
      if (!response.ok) {
        const decoder = new TextDecoder(); let body = "";
        if (response.body) for await (const chunk of bytes(response.body, signal, aborted)) body += decoder.decode(chunk, { stream: true });
        body += decoder.decode(); let message = body; let code: string | null = null;
        try { const error = JSON.parse(body); if (typeof error.error === "string") message = error.error; if (typeof error.error_code === "string") code = error.error_code; } catch {}
        throw new KugelAudioError(message, response.status, code, response.headers.get("retry-after"));
      }
      if (!response.body) throw new TypeError("KugelAudio returned no audio stream");
      const rate = response.headers.get("x-sample-rate"); const encoding = response.headers.get("x-audio-format");
      if ((rate !== null && Number(rate) !== sampleRate) || (encoding !== null && encoding !== (format === "pcm" ? "pcm_s16le" : format))) throw new TypeError("KugelAudio returned an unexpected audio format");
      yield* bytes(response.body, signal, aborted);
    } finally { if (!response.body?.locked) void response.body?.cancel().catch(() => {}); }
  } finally { if (timeout !== undefined) clearTimeout(timeout); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
