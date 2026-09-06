import type { TtsRequest, TtsInput } from "../../../schemas/providers/minimax/index.ts";
import type { Auth } from "../../auth.ts";
import type { ClearEvent, FlushEvent } from "../../dispatch.ts";
import { validateRequest } from "../../generated/validators/minimax.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { serverSentEvents } from "../../runtime/sse.ts";
import type { Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";
import { decodePacket, decodeSocketMessage, decodeSubtitles, MiniMaxError, type Packet, type Usage } from "./protocol.ts";

export type { TtsRequest, TtsInput } from "../../../schemas/providers/minimax/index.ts";
export { MiniMaxError } from "./protocol.ts";
export type { Usage } from "./protocol.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  /** Exclusive authenticated socket; synthesis closes it on completion or cancellation. */
  readonly webSocket?: WebSocketLike;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface MiniMaxEnvelope {
  readonly correlation: "ordered" | "timeline";
  readonly correlationId?: string;
  readonly inputGroupId?: string;
  readonly traceId?: string;
  readonly audio?: Uint8Array;
  readonly timestamps: readonly Timestamp<"word" | "sentence">[];
  /** Native boundaries, not timestamps inferred from arrival time. */
  readonly sentenceBoundary?: "start" | "end";
  /** End of one native request's audio, not the sentence or session. */
  readonly requestComplete?: boolean;
  readonly usage?: Usage;
}
export interface MiniMaxDoneEvent { readonly event: "done"; readonly traceId?: string; readonly usage?: Usage }
type Output = Uint8Array | MiniMaxEnvelope | ClearEvent | FlushEvent | MiniMaxDoneEvent;

interface Configuration {
  readonly model: string;
  readonly language_boost: string;
  readonly voice_setting: {
    readonly voice_id: string; readonly speed: number; readonly vol: number; readonly pitch: number;
    readonly emotion?: string; readonly text_normalization?: boolean; readonly english_normalization?: boolean; readonly latex_read: boolean;
  };
  readonly audio_setting: { readonly format: string; readonly sample_rate: number; readonly channel: number; readonly bitrate?: number; readonly force_cbr?: boolean };
  readonly timbre_weights?: readonly { readonly voice_id: string; readonly weight: number }[];
  readonly pronunciation_dict?: { readonly tone: readonly string[] };
  readonly voice_modify?: { readonly pitch?: number; readonly intensity?: number; readonly timbre?: number; readonly sound_effects?: string };
  readonly continuous_sound?: boolean;
}
const languages: Readonly<Record<string, string>> = {
  zh: "Chinese", yue: "Chinese,Yue", en: "English", ar: "Arabic", ru: "Russian", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", tr: "Turkish",
  nl: "Dutch", uk: "Ukrainian", vi: "Vietnamese", id: "Indonesian", ja: "Japanese", it: "Italian", ko: "Korean", th: "Thai", pl: "Polish", ro: "Romanian",
  el: "Greek", cs: "Czech", fi: "Finnish", hi: "Hindi", bg: "Bulgarian", da: "Danish", he: "Hebrew", ms: "Malay", fa: "Persian", sk: "Slovak", sv: "Swedish",
  hr: "Croatian", fil: "Filipino", hu: "Hungarian", no: "Norwegian", sl: "Slovenian", ca: "Catalan", nn: "Nynorsk", ta: "Tamil", af: "Afrikaans", auto: "auto",
};

function configuration(request: TtsRequest, socket: boolean): Configuration {
  const output = request.output ?? { format: "mp3" };
  const format = output.format === "ogg_opus" ? "opus" : output.format === "mulaw" ? "pcmu_raw"
    : output.format === "wav" && output.sampleEncoding === "mulaw" ? "pcmu_wav" : output.format;
  const transform = request.voiceTransform;
  return {
    model: request.model ?? "speech-2.8-hd", language_boost: languages[request.language ?? (request.formulaReading ? "zh" : "auto")]!,
    voice_setting: { voice_id: request.voice ?? "", speed: request.speed ?? 1, vol: request.volumeScale ?? 1, pitch: request.pitchBias ?? 0,
      ...(request.emotion === undefined ? {} : { emotion: request.emotion }), latex_read: request.formulaReading === "latex",
      ...(socket ? { english_normalization: request.languageTextNormalization ?? false } : { text_normalization: request.textNormalization ?? false }) },
    audio_setting: { format, sample_rate: output.sampleRateHz ?? (format === "pcmu_raw" || format === "pcmu_wav" ? 8000 : format === "opus" ? 24000 : 32000),
      channel: output.channelCount ?? 1, ...(format === "mp3" ? { bitrate: output.bitRateBps ?? 128000,
        ...(socket ? {} : { force_cbr: output.constantBitRate ?? false }) } : {}) },
    ...(request.voiceBlend === undefined ? {} : { timbre_weights: request.voiceBlend.map(voice => ({ voice_id: voice.voice, weight: voice.weight })) }),
    ...(request.replacements === undefined ? {} : { pronunciation_dict: { tone: request.replacements.map(item => `${item.pattern}/${item.replacement}`) } }),
    ...(transform === undefined ? {} : { voice_modify: {
      ...(transform.brightness === undefined ? {} : { pitch: transform.brightness }), ...(transform.softness === undefined ? {} : { intensity: transform.softness }),
      ...(transform.crispness === undefined ? {} : { timbre: transform.crispness }),
      ...(transform.effect === undefined ? {} : { sound_effects: transform.effect === "telephone" ? "lofi_telephone" : transform.effect }),
    } }),
    ...(socket && (request.model === undefined || request.model === "speech-2.8-hd" || request.model === "speech-2.8-turbo") ? { continuous_sound: !(request.splitTurns ?? true) } : {}),
  };
}

async function* bytes(body: ReadableStream<Uint8Array>, signal: AbortSignal, aborted: Promise<never>): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const item = await Promise.race([reader.read(), aborted]); signal.throwIfAborted(); if (item.done) return; yield item.value; }
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function json(body: ReadableStream<Uint8Array>, signal: AbortSignal, aborted: Promise<never>): Promise<unknown> {
  const decoder = new TextDecoder(); let text = "";
  for await (const chunk of bytes(body, signal, aborted)) text += decoder.decode(chunk, { stream: true });
  return JSON.parse(text + decoder.decode());
}

async function* socketSynthesis(input: AsyncIterable<TtsInput>, config: Configuration, socket: WebSocketLike, signal: AbortSignal,
  validateInput: (item: unknown) => void): AsyncIterableIterator<Output> {
  const connection = await connectWebSocket({ socket, encode: (message: object) => JSON.stringify(message), decode: decodeSocketMessage, signal });
  const sessionId = crypto.randomUUID(); let source: AsyncIterator<TtsInput> | undefined;
  let inputDone = false; let stopped = false; let finished = false; let clearing = false;
  const stopInput = () => {
    if (!source || inputDone || stopped) return; stopped = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  const receive = async () => {
    signal.throwIfAborted(); const item = await connection.messages.next(); signal.throwIfAborted();
    if (item.done) throw new TypeError("MiniMax WebSocket closed before task_finished");
    if (item.value.code !== 0) throw new MiniMaxError(item.value.message, item.value.code, null);
    return item.value;
  };
  try {
    const connected = await receive();
    if (connected.event !== "connected_success") throw new TypeError("MiniMax did not acknowledge the connection");
    const connectionId = connected.connectionId ?? connected.sessionId;
    connection.send({ ...config, event: "task_start", session_id: sessionId, subtitle_enable: false });
    const started = await receive();
    if (started.event !== "task_started") throw new TypeError("MiniMax did not acknowledge task_start");
    if (started.sessionId !== undefined && started.sessionId !== sessionId) throw new TypeError("MiniMax returned an unexpected session ID");
    source = input[Symbol.asyncIterator]();
    let failInput!: (error: unknown) => void;
    const inputFailure = new Promise<{ kind: "error"; error: unknown }>(resolve => { failInput = error => resolve({ kind: "error", error }); });
    const nextInput = () => Promise.resolve().then(() => { signal.throwIfAborted(); return source!.next(); }).then(value => ({ kind: "input" as const, value }), error => {
      failInput(error); return { kind: "error" as const, error };
    });
    const nextOutput = () => receive().then(value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }));
    let pendingInput: ReturnType<typeof nextInput> | undefined = nextInput(); let pendingOutput = nextOutput();
    let preferInput = false; let whitespace = "";
    for (;;) {
      signal.throwIfAborted();
      const item = await (pendingInput && !clearing ? Promise.race(preferInput ? [pendingInput, pendingOutput] : [pendingOutput, pendingInput]) : Promise.race([pendingOutput, inputFailure]));
      preferInput = !preferInput;
      if (item.kind === "error") throw item.error;
      if (item.kind === "input") {
        if (item.value.done) { inputDone = true; pendingInput = undefined; whitespace = ""; connection.send({ event: "task_finish" }); }
        else {
          validateInput(item.value.value);
          const part = item.value.value;
          if (typeof part === "string") {
            // The schema cannot annotate primitive async elements with lengths.
            if (part.length >= 10000) throw new TypeError("MiniMax text pieces must contain fewer than 10000 UTF-16 code units");
            let text = whitespace + part; whitespace = "";
            // The service discards whitespace-only frames. Hold them so an LLM's
            // standalone space token cannot silently join adjacent words.
            if (!text.trim()) {
              if (text.length >= 10000) throw new TypeError("MiniMax pending whitespace exceeds a native message");
              whitespace = text;
            } else {
              while (text.length) {
                let length = Math.min(9999, text.length);
                const last = text.charCodeAt(length - 1);
                if (length < text.length && last >= 0xd800 && last <= 0xdbff) length--;
                const piece = text.slice(0, length); text = text.slice(length);
                if (piece.trim()) connection.send({ event: "task_continue", text: piece });
                else if (text.length) throw new TypeError("MiniMax pending whitespace exceeds a native message");
                else whitespace = piece;
              }
            }
          } else if (part.command === "clear") { whitespace = ""; clearing = true; connection.send({ event: "task_cancel" }); }
          else { whitespace = ""; connection.send({ event: "task_flush" }); }
          pendingInput = nextInput();
        }
        continue;
      }
      const packet = item.value;
      if (packet.sessionId !== undefined && packet.sessionId !== sessionId) throw new TypeError("MiniMax returned an unexpected session ID");
      if (connectionId !== undefined && packet.connectionId !== undefined && packet.connectionId !== connectionId) throw new TypeError("MiniMax returned an unexpected connection ID");
      const event = packet.event ?? (packet.audio !== undefined || packet.final !== undefined ? "task_continued" : undefined);
      if (event === "task_failed") throw new MiniMaxError(packet.message || "MiniMax synthesis task failed", packet.code, null);
      if (event === "task_finished" && clearing) throw new TypeError("MiniMax ended the session before acknowledging cancellation");
      const group = { correlation: "ordered" as const, inputGroupId: sessionId,
        ...(packet.traceId === undefined ? {} : { correlationId: packet.traceId, traceId: packet.traceId }) };
      if (event === "task_canceled") {
        if (!clearing) throw new TypeError("MiniMax returned an unsolicited cancel acknowledgement");
        clearing = false; yield { event: "clear" };
      } else if (!clearing) {
        if (event === "task_finished") {
          if (!inputDone) throw new TypeError("MiniMax ended the session before task_finish");
          finished = true; yield { event: "done", ...(packet.traceId === undefined ? {} : { traceId: packet.traceId }), ...(packet.usage === undefined ? {} : { usage: packet.usage }) }; return;
        }
        if (event === "task_flushed") {
          yield { event: "flush", correlationId: packet.traceId ?? sessionId, inputGroupId: sessionId };
        } else if (event === "sentence_start" || event === "sentence_end") {
          yield { ...group, timestamps: [], sentenceBoundary: event === "sentence_start" ? "start" : "end" };
        } else if (event === "task_continued") {
          if (packet.audio?.byteLength || packet.final || packet.usage !== undefined) yield { ...group, timestamps: [],
            ...(packet.audio?.byteLength ? { audio: packet.audio } : {}), ...(packet.final ? { requestComplete: true } : {}),
            ...(packet.usage === undefined ? {} : { usage: packet.usage }) };
        }
      }
      pendingOutput = nextOutput();
    }
  } finally {
    signal.removeEventListener("abort", stopInput); stopInput();
    if (!finished) { try { connection.send({ event: "task_cancel" }); } catch {} }
    connection.close();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  let validateInput = validateRequest(request);
  if (request.volumeScale === 0) throw new TypeError("MiniMax volumeScale must be strictly positive");
  const transform = request.voiceTransform;
  for (const value of [request.pitchBias, transform?.brightness, transform?.softness, transform?.crispness, ...(request.voiceBlend?.map(item => item.weight) ?? [])]) {
    if (value !== undefined && !Number.isSafeInteger(value)) throw new TypeError("MiniMax pitch, voice transformations and blend weights must be integers");
  }
  if (request.voiceBlend !== undefined && (request.voiceBlend.length < 1 || request.voiceBlend.length > 4)) throw new TypeError("MiniMax voiceBlend must contain one to four voices");
  const socketMode = typeof request.text !== "string" || options.webSocket !== undefined || options.webSocketUrl !== undefined;
  const input = typeof request.text === "string" ? (async function* () { yield request.text as string; })() : request.text;
  // A transport override must satisfy the generated WebSocket variant too.
  if (socketMode && typeof request.text === "string") validateInput = validateRequest({ ...request, text: input });
  const config = configuration(request, socketMode);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.minimax?.apiKey ?? environment.SPEECHSWITCH_MINIMAX_API_KEY ?? environment.MINIMAX_API_KEY;
  if (!apiKey && !options.webSocket) throw new TypeError("Missing auth.minimax.apiKey configuration");
  const baseUrl = options.baseUrl ?? "https://api.minimax.io";
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("MiniMax timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("MiniMax synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void; const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timeout = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("MiniMax synthesis deadline expired", "TimeoutError")), timeoutMs);
  const send = async (url: URL, init: RequestInit) => {
    signal.throwIfAborted(); const pending = fetch(url, { ...init, signal });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    return await Promise.race([pending, aborted]);
  };
  try {
    if (socketMode) {
      let socket = options.webSocket;
      if (!socket) {
        if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("MiniMax native WebSocket auth requires Node or Bun; supply an authenticated socket in browsers");
        const url = new URL(options.webSocketUrl ?? baseUrl);
        if (!options.webSocketUrl) { url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/v1/t2a_v2_bidi`; }
        const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
        if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
        socket = new Constructor(url.href, { headers: { Authorization: `Bearer ${apiKey}` } });
      }
      yield* socketSynthesis(input, config, socket, signal, validateInput); return;
    }
    const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/t2a_v2`;
    const streaming = config.audio_setting.format !== "wav" && !(config.voice_modify && config.audio_setting.format === "flac");
    const response = await send(url, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, text: request.text, stream: streaming, output_format: "hex", ...(streaming ? { stream_options: { exclude_aggregated_audio: true } } : {}),
        subtitle_enable: request.timestampGranularity !== undefined, ...(request.timestampGranularity === undefined ? {} : { subtitle_type: request.timestampGranularity }) }) });
    try {
      if (!response.body) throw new MiniMaxError("MiniMax returned no response body", null, response.status);
      let final: Packet | undefined; let receivedAudio = false;
      const timed = request.timestampGranularity !== undefined;
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!response.ok || contentType !== "text/event-stream") {
        let document: unknown;
        try { document = await json(response.body, signal, aborted); }
        catch (error) {
          if (!response.ok && error instanceof SyntaxError) throw new MiniMaxError(`MiniMax HTTP ${response.status}`, null, response.status, response.headers.get("retry-after"));
          throw error;
        }
        const packet = decodePacket(document);
        if (!response.ok || packet.code !== 0) throw new MiniMaxError(packet.message || `MiniMax HTTP ${response.status}`, packet.code || null, response.status, response.headers.get("retry-after"));
        if (packet.status !== 2) throw new TypeError("MiniMax JSON synthesis did not report completion");
        final = packet;
        if (packet.audio?.byteLength) { receivedAudio = true; yield timed ? { correlation: "timeline", audio: packet.audio, timestamps: [], ...(packet.traceId === undefined ? {} : { traceId: packet.traceId }) } : packet.audio; }
      } else {
        for await (const data of serverSentEvents(bytes(response.body, signal, aborted))) {
          if (data === "[DONE]") break;
          const packet = decodePacket(JSON.parse(data));
          if (packet.code !== 0) throw new MiniMaxError(packet.message, packet.code, response.status, response.headers.get("retry-after"));
          if (packet.status !== 1 && packet.status !== 2) throw new TypeError("MiniMax SSE audio is missing data.status");
          if (packet.audio?.byteLength) { receivedAudio = true; yield timed ? { correlation: "timeline", audio: packet.audio, timestamps: [], ...(packet.traceId === undefined ? {} : { traceId: packet.traceId }) } : packet.audio; }
          if (packet.status === 2) { final = packet; break; }
        }
      }
      if (!final) throw new TypeError("MiniMax HTTP stream ended before completion");
      if (!receivedAudio) throw new TypeError("MiniMax returned no audio");
      if (request.timestampGranularity !== undefined) {
        if (!final.subtitleFile) throw new TypeError("MiniMax omitted requested subtitles");
        const subtitleUrl = new URL(final.subtitleFile);
        if (!["https:", "http:"].includes(subtitleUrl.protocol) || subtitleUrl.username || subtitleUrl.password) throw new TypeError("MiniMax returned an invalid subtitle URL");
        const subtitles = await send(subtitleUrl, { method: "GET", credentials: "omit", redirect: "error" });
        try {
          if (!subtitles.ok || !subtitles.body) throw new MiniMaxError("MiniMax subtitle download failed", null, subtitles.status);
          yield { correlation: "timeline", timestamps: decodeSubtitles(await json(subtitles.body, signal, aborted), request.timestampGranularity),
            ...(final.traceId === undefined ? {} : { traceId: final.traceId }) };
        } finally { if (!subtitles.body?.locked) void subtitles.body?.cancel().catch(() => {}); }
      }
      yield { event: "done", ...(final.traceId === undefined ? {} : { traceId: final.traceId }), ...(final.usage === undefined ? {} : { usage: final.usage }) };
    } finally { if (!response.body?.locked) void response.body?.cancel().catch(() => {}); }
  } finally { if (timeout !== undefined) clearTimeout(timeout); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
