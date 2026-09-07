import type { TtsRequest, TtsInput, SynthesisItem as Output } from "../../../schemas/providers/murf/index.ts";
import type { Auth } from "../../auth.ts";
import { validateRequest } from "../../generated/validators/murf.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";
import { decodeGeneration, decodeSocket, MurfError } from "./protocol.ts";

export type { TtsRequest, TtsInput, UpdateCommand, MurfTimestamp, MurfEnvelope, DoneEvent, SynthesisItem } from "../../../schemas/providers/murf/index.ts";
export { MurfError } from "./protocol.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  /** Exclusive socket override; closed at the end of this operation. */
  readonly webSocket?: WebSocketLike;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
interface SocketSettings {
  readonly voice: { readonly voice_id: string; readonly rate: number; readonly pitch: number; readonly style?: string; readonly locale?: string };
  readonly minBufferSize: number;
  readonly maxBufferDelayMs: number;
}

async function* bytes(body: ReadableStream<Uint8Array>, signal: AbortSignal, aborted: Promise<never>): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader(); const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const item = await Promise.race([reader.read(), aborted]); signal.throwIfAborted(); if (item.done) return; yield item.value; }
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function bodyText(response: Response, signal: AbortSignal, aborted: Promise<never>): Promise<string> {
  if (!response.body) return "";
  const decoder = new TextDecoder(); let text = "";
  for await (const chunk of bytes(response.body, signal, aborted)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

async function* socketSynthesis(settings: SocketSettings, input: AsyncIterable<TtsInput>, socket: WebSocketLike, signal: AbortSignal, validateInput: (item: unknown) => void): AsyncIterableIterator<Output> {
  const connection = await connectWebSocket({ socket, signal, encode: (message: object) => JSON.stringify(message), decode: decodeSocket });
  let source: AsyncIterator<TtsInput> | undefined; let sourceDone = false;
  let voice = settings.voice;
  const contexts = new Map<string, { ended: boolean; flush: boolean; receivedAudio: boolean }>(); const retired = new Set<string>();
  let current: string | undefined; let sequence = 0; const sessionId = crypto.randomUUID();
  const end = (flush: boolean) => {
    if (!current) return;
    const context = contexts.get(current)!; context.ended = true; context.flush = flush;
    connection.send({ context_id: current, text: "", end: true }); current = undefined;
  };
  const closeInput = () => {
    if (!source || sourceDone) return; sourceDone = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", closeInput, { once: true });
  try {
    signal.throwIfAborted();
    connection.send({ min_buffer_size: settings.minBufferSize, max_buffer_delay_in_ms: settings.maxBufferDelayMs });
    source = input[Symbol.asyncIterator]();
    const nextInput = () => Promise.resolve(source!.next()).then(item => ({ type: "input" as const, item }));
    const nextMessage = () => connection.messages.next().then(item => ({ type: "message" as const, item }));
    let pendingInput = nextInput(); let pendingMessage = nextMessage();
    void pendingInput.catch(() => {}); void pendingMessage.catch(() => {});
    while (!sourceDone || contexts.size) {
      const result = await Promise.race(sourceDone ? [pendingMessage] : [pendingMessage, pendingInput]); signal.throwIfAborted();
      if (result.type === "message") {
        if (result.item.done) throw new TypeError("Murf WebSocket closed before all contexts completed");
        const packet = result.item.value; pendingMessage = nextMessage(); void pendingMessage.catch(() => {});
        if (retired.has(packet.contextId)) continue;
        const context = contexts.get(packet.contextId);
        if (!context) throw new TypeError("Murf returned an unknown context ID");
        if (packet.audio?.byteLength) { context.receivedAudio = true; yield { correlation: "ordered", correlationId: packet.contextId, audio: packet.audio, timestamps: [] }; }
        if (packet.final) {
          if (!context.ended) throw new TypeError("Murf completed a context before its text ended");
          if (!context.receivedAudio) throw new TypeError("Murf completed a context without audio");
          contexts.delete(packet.contextId);
          if (context.flush) yield { event: "flush", correlationId: packet.contextId, inputGroupId: packet.contextId };
        }
      } else {
        if (result.item.done) { sourceDone = true; end(false); continue; }
        const item = result.item.value; validateInput(item);
        if (typeof item === "string") {
          if (item.length > 3000) throw new TypeError("Murf text messages must not exceed 3000 characters");
          if (item) {
            if (!current) { current = `${sessionId}:${sequence++}`; contexts.set(current, { ended: false, flush: false, receivedAudio: false }); }
            connection.send({ context_id: current, voice_config: voice, text: item });
          }
        } else if (item.command === "clear") {
          for (const id of contexts.keys()) { connection.send({ context_id: id, clear: true }); retired.add(id); }
          contexts.clear(); current = undefined;
          // Local playback invalidation, not an invented server acknowledgement.
          yield { event: "clear" };
        } else if (item.command === "flush") end(true);
        else {
          voice = { ...voice, ...(item.voice === undefined ? {} : { voice_id: item.voice }), ...(item.voiceStyle === undefined ? {} : { style: item.voiceStyle }),
            ...(item.language === undefined ? {} : { locale: item.language }), ...(item.speedBias === undefined ? {} : { rate: item.speedBias }), ...(item.pitchBias === undefined ? {} : { pitch: item.pitchBias }) };
          if (current) connection.send({ context_id: current, voice_config: voice });
          if (item.textBufferThreshold !== undefined || item.maxBufferDelayMs !== undefined) connection.send({
            ...(item.textBufferThreshold === undefined ? {} : { min_buffer_size: item.textBufferThreshold }), ...(item.maxBufferDelayMs === undefined ? {} : { max_buffer_delay_in_ms: item.maxBufferDelayMs }) });
        }
        pendingInput = nextInput(); void pendingInput.catch(() => {});
      }
    }
    yield { event: "done" };
  } finally { signal.removeEventListener("abort", closeInput); closeInput(); connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  const validateInput = validateRequest(request);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.murf?.apiKey ?? environment.SPEECHSWITCH_MURF_API_KEY ?? environment.MURF_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.murf.apiKey configuration");
  const model = request.model ?? "falcon-2"; const streamingInput = typeof request.text !== "string";
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? (model === "gen2" ? "https://api.murf.ai" : "https://global.api.murf.ai");
  const output = request.output ?? { format: "pcm" };
  const format = output.format === "mulaw" ? "ULAW" : output.format.toUpperCase();
  const sampleRate = output.sampleRateHz ?? (model === "gen2" ? 44100 : 24000); const channelType = output.channelCount === 2 ? "STEREO" : "MONO";
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Murf timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("Murf synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void; const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Murf synthesis deadline expired", "TimeoutError")), timeoutMs);
  const send = async (url: URL, init: RequestInit) => {
    signal.throwIfAborted(); const pending = fetch(url, { ...init, signal });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    if (!response.ok) throw new MurfError(response.status, await bodyText(response, signal, aborted), response.headers.get("retry-after"));
    return response;
  };
  try {
    if (streamingInput) {
      let socket = options.webSocket;
      if (!socket) {
        const url = new URL(options.webSocketUrl ?? baseUrl);
        if (!options.webSocketUrl) { url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/speech/stream-input`; }
        url.searchParams.set("model", model); url.searchParams.set("format", format); url.searchParams.set("sample_rate", String(sampleRate)); url.searchParams.set("channel_type", channelType);
        if (typeof process !== "undefined" && process.versions?.node) {
          const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
          if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
          socket = new Constructor(url.href, { headers: { api_key: apiKey } });
        } else {
          url.searchParams.set("api_key", apiKey);
          socket = new WebSocket(url);
        }
      }
      const settings: SocketSettings = { voice: { voice_id: request.voice, rate: request.speedBias ?? 0, pitch: request.pitchBias ?? 0,
        ...(request.voiceStyle === undefined ? {} : { style: request.voiceStyle }), ...(request.language === undefined ? {} : { locale: request.language }) },
        minBufferSize: request.textBufferThreshold ?? 40, maxBufferDelayMs: request.maxBufferDelayMs ?? 300 };
      yield* socketSynthesis(settings, request.text as AsyncIterable<TtsInput>, socket, signal, validateInput); return;
    }
    if (options.webSocket) throw new TypeError("Murf webSocket override requires streaming text input");
    const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/speech/${model === "gen2" ? "generate" : "stream"}`;
    const response = await send(url, { method: "POST", redirect: "error", headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: model === "gen2" ? "application/json" : "audio/*, application/octet-stream" },
      body: JSON.stringify({ text: request.text, voiceId: request.voice, rate: request.speedBias ?? 0, pitch: request.pitchBias ?? 0, format, sampleRate, channelType,
        ...(request.language === undefined ? {} : { locale: request.language }), ...(request.voiceStyle === undefined ? {} : { style: request.voiceStyle }),
        ...(model === "gen2" ? { modelVersion: "GEN2", variation: (request.deliveryVariance ?? 0.2) * 5, encodeAsBase64: request.audioRetention === false,
          wordDurationsAsOriginalText: request.timestampText === "original", ...(request.targetDurationMs === undefined ? {} : { audioDuration: request.targetDurationMs / 1000 }) } : { model }) }) });
    let receivedAudio = false;
    if (model === "gen2") {
      const generation = decodeGeneration(JSON.parse(await bodyText(response, signal, aborted)), request.timestampGranularity === "word", request.audioRetention === false);
      const wrap = (audio: Uint8Array): Output => request.timestampGranularity ? { correlation: "timeline", audio, timestamps: [] } : audio;
      if (generation.audio) { if (generation.audio.byteLength) { receivedAudio = true; yield wrap(generation.audio); } }
      else {
        const assetUrl = new URL(generation.audioUrl!);
        if (assetUrl.protocol !== "https:" || assetUrl.username || assetUrl.password) throw new TypeError("Murf returned an unsafe audio file URL");
        // CDN requests never inherit API credentials or follow redirects to an unchecked target.
        const asset = await send(assetUrl, { method: "GET", redirect: "error", credentials: "omit" });
        if (!asset.body) throw new TypeError("Murf returned no audio body");
        for await (const chunk of bytes(asset.body, signal, aborted)) if (chunk.byteLength) { receivedAudio = true; yield wrap(chunk); }
      }
      if (!receivedAudio) throw new TypeError("Murf returned no audio");
      if (request.timestampGranularity) yield { correlation: "timeline", durationMs: generation.durationMs, timestamps: generation.timestamps };
      yield { event: "done", remainingCharacters: generation.remainingCharacters, ...(generation.warning === undefined ? {} : { warning: generation.warning }) };
    } else {
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType && !contentType.startsWith("audio/") && contentType !== "application/octet-stream") { void response.body?.cancel().catch(() => {}); throw new TypeError("Murf returned a non-audio streaming response"); }
      if (!response.body) throw new TypeError("Murf returned no audio body");
      for await (const chunk of bytes(response.body, signal, aborted)) if (chunk.byteLength) { receivedAudio = true; yield chunk; }
      if (!receivedAudio) throw new TypeError("Murf returned no audio");
      yield { event: "done" };
    }
  } finally { if (timer !== undefined) clearTimeout(timer); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
