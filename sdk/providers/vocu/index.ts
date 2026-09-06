import type { JsonValue } from "../../../schemas/base.ts";
import type { TextSplitter, TtsBinding, TtsRequest, TtsSegment, VocuDoneEvent } from "../../../schemas/providers/vocu/index.ts";
import type { Auth } from "../../auth.ts";
import { validateRequest } from "../../generated/validators/vocu.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { isJsonValue } from "../../runtime/json.ts";

export type { TextSplitter, TtsBinding, TtsRequest, TtsSegment, VocuDoneEvent } from "../../../schemas/providers/vocu/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  /** Default direct byte streaming; batches and saved splitters require async jobs. */
  readonly mode?: "stream" | "http" | "async";
  readonly signal?: AbortSignal;
  /** Whole operation, including queueing, polling and audio reads. No implicit short queue timeout. */
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  /** Bound native JSON and header metadata, never the audio stream. Default 4 MiB. */
  readonly maxMetadataBytes?: number;
  /** Additional trusted origins for native audio URLs, e.g. an injected local test server. Credentials are never forwarded. */
  readonly audioOrigins?: readonly string[];
}

export class VocuError extends Error {
  override readonly name = "VocuError";
  readonly status: number | null;
  readonly jobId: string | null;
  readonly requestId: string | null;
  readonly retryAfter: string | null;
  constructor(status: number | null, jobId: string | null, requestId: string | null, retryAfter: string | null) {
    super(status === null ? "Vocu generation failed" : `Vocu returned HTTP ${status}`);
    this.status = status; this.jobId = jobId; this.requestId = requestId; this.retryAfter = retryAfter;
  }
}

function wireBinding(request: TtsBinding) {
  const blend = request.emotionBlend;
  const language = request.language;
  return {
    ...(request.voice === undefined ? {} : { voiceId: request.voice }),
    ...(request.voiceStyle === undefined ? {} : { promptId: request.voiceStyle }),
    ...(request.deliveryMode === undefined ? {} : { preset: request.deliveryMode === "balanced" ? "balance" : request.deliveryMode }),
    ...(language === undefined ? {} : { language: language === "en-US" ? "en-us" : language === "fr-FR" ? "fr-fr" : language }),
    ...(request.vividExpression === undefined ? {} : { vivid: request.vividExpression }),
    ...(request.speed === undefined ? {} : { speechRate: 1 / request.speed }),
    ...(request.randomSeed === undefined ? {} : { seed: request.randomSeed }),
    ...(request.emotionSource === undefined ? {} : { break_clone: request.emotionSource === "text" }),
    ...(blend === undefined ? {} : { emo_switch: [blend.anger ?? 0, blend.happiness ?? 0, blend.neutral ?? 0, blend.sadness ?? 0, blend.contextual ?? 0] }),
    ...(request.longTextMode === undefined ? {} : { infinite_mode: request.longTextMode }),
    ...(request.audioProcessingProfile === undefined ? {} : { post_processing: request.audioProcessingProfile }),
    ...(request.inputType === undefined ? {} : { instruct_mode: request.inputType === "markup", ...(request.referenceEmphasis === undefined ? {} : { reference_mode: request.referenceEmphasis }) }),
  };
}
function wireSpeech(request: TtsSegment | Extract<TtsRequest, { readonly voice: string }>) {
  return { ...wireBinding({ ...request, voiceStyle: request.voiceStyle ?? "default", deliveryMode: request.deliveryMode ?? "balanced",
    language: request.language ?? "auto", vividExpression: request.vividExpression ?? false, speed: request.speed ?? 1, randomSeed: request.randomSeed ?? -1 }), text: request.text };
}
function wireSplitter(splitter: TextSplitter) {
  if (splitter.id !== undefined) return { splitterId: splitter.id };
  const native: Record<string, unknown> = Object.create(null);
  for (const rule of splitter.placeholders ?? []) {
    // A flat native object mixes user markers with three protocol keys.
    if (["splitterMarks", "lookupTable", "fallbackConfig"].includes(rule.marker) || Object.hasOwn(native, rule.marker)) throw new TypeError("Vocu splitter markers must be unique and cannot use reserved protocol keys");
    native[rule.marker] = wireBinding(rule);
  }
  if (splitter.brackets !== undefined) native.splitterMarks = splitter.brackets.map(pair => pair.open + pair.close);
  if (splitter.fallback !== undefined) native.fallbackConfig = wireBinding(splitter.fallback);
  if (splitter.lookup !== undefined) native.lookupTable = Object.fromEntries(splitter.lookup.map((rule, index) => [`entry${index}`, { ...wireBinding(rule), tags: rule.tags }]));
  return { splitter: native };
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

function metadata(text: string): JsonValue {
  const value: unknown = JSON.parse(text);
  if (!isJsonValue(value)) throw new TypeError("Invalid Vocu metadata");
  return value as JsonValue;
}
function object(value: JsonValue | undefined): { readonly [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Vocu response object");
  return value as { readonly [key: string]: JsonValue };
}
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array | VocuDoneEvent> {
  validateRequest(request);
  const mode = options.mode ?? (request.segments !== undefined || request.textSplitter !== undefined ? "async" : "stream");
  if (mode !== "stream" && mode !== "http" && mode !== "async") throw new TypeError("Invalid Vocu mode");
  if ((request.segments !== undefined || request.textSplitter !== undefined) && mode !== "async") throw new TypeError("Vocu segments and text splitting require async synthesis");
  if (mode === "async" && request.latencyOptimization === "maximum") throw new TypeError("Vocu async synthesis does not support flash latency optimization");
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.vocu?.apiKey ?? environment.SPEECHSWITCH_VOCU_API_KEY ?? environment.VOCU_API_KEY;
  const token = mode === "async" ? options.auth?.vocu?.apiKey ?? options.auth?.vocu?.accessToken ?? apiKey ?? environment.SPEECHSWITCH_VOCU_ACCESS_TOKEN ?? environment.VOCU_ACCESS_TOKEN : apiKey;
  if (mode !== "async" && !apiKey) throw new TypeError("Missing auth.vocu.apiKey configuration");
  if (!token) throw new TypeError("Missing auth.vocu.apiKey or auth.vocu.accessToken configuration");
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = new URL(options.baseUrl ?? "https://v1.vocu.ai");
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || !["http:", "https:"].includes(baseUrl.protocol)) throw new TypeError("Invalid Vocu base URL");
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const timeoutMs = options.timeoutMs;
  for (const value of [pollIntervalMs, timeoutMs]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)) throw new TypeError("Vocu polling interval and timeout must be integers between 0 and 2147483647");
  }
  const maxMetadataBytes = options.maxMetadataBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(maxMetadataBytes) || maxMetadataBytes <= 0) throw new TypeError("Vocu maxMetadataBytes must be a positive safe integer");
  const audioOrigins = new Set(["https://storage.vocu.ai", "https://storage.vocu.studio", "https://v1.vocu.ai", "https://v1.vocu.studio"]);
  for (const origin of options.audioOrigins ?? []) {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) throw new TypeError("Vocu audioOrigins must contain HTTP(S) origins only");
    audioOrigins.add(origin);
  }
  const audioUrl = (address: JsonValue | undefined): URL => {
    if (typeof address !== "string" || !address.trim()) throw new TypeError("Vocu returned no audio URL");
    const url = new URL(address, baseUrl);
    if (!audioOrigins.has(url.origin) || url.username || url.password || url.hash) throw new TypeError("Vocu returned an untrusted audio URL");
    return url;
  };
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted();
  if (timeoutMs === 0) throw new DOMException("Vocu synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Vocu synthesis deadline expired", "TimeoutError")), timeoutMs);
  let requestId: string | undefined;
  let jobId: string | null = null;
  const send = async (url: URL, init: RequestInit): Promise<Response> => {
    signal.throwIfAborted();
    const pending = fetch(url, { ...init, signal, redirect: "error", credentials: "omit" });
    // Injected fetch may resolve after cancellation. Release that late body too.
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new VocuError(response.status, jobId, response.headers.get("x-vocu-app-request-id"), response.headers.get("retry-after"));
    }
    return response;
  };
  const api = async (path: string, body?: object): Promise<Response> => {
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/tts/${path}`;
    const response = await send(url, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    requestId = response.headers.get("x-vocu-app-request-id") ?? requestId;
    return response;
  };
  const json = async (response: Response): Promise<{ readonly [key: string]: JsonValue }> => {
    if (!response.body) throw new TypeError("Vocu returned no metadata body");
    let size = 0; let text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for await (const chunk of bytes(response.body, signal, aborted)) {
      size += chunk.byteLength;
      if (size > maxMetadataBytes) throw new TypeError("Vocu metadata exceeds maxMetadataBytes");
      text += decoder.decode(chunk, { stream: true });
    }
    const value = object(metadata(text + decoder.decode()));
    if (value.status !== 200) throw new TypeError("Invalid Vocu response status");
    return object(value.data);
  };
  try {
    let result: { readonly [key: string]: JsonValue } | undefined;
    let audioResponse: Response;
    let completion: VocuDoneEvent["completion"] = "transport";
    if (mode === "async") {
      const payload = request.textSplitter !== undefined ? { text: request.text, ...wireSplitter(request.textSplitter) }
        : { contents: request.segments !== undefined ? request.segments.map(segment => ({ type: "text", ...wireSpeech(segment) })) : [{ type: "text", ...wireSpeech(request) }] };
      result = await json(await api("generate", { ...payload, srt: request.subtitleFormat === "srt" }));
      const id = result.id;
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new TypeError("Invalid Vocu job ID");
      jobId = id;
      for (;;) {
        if (result.id !== id) throw new TypeError("Vocu returned a different job ID while polling");
        if (result.status === "failed") throw new VocuError(null, id, requestId ?? null, null);
        if (result.status === "generated") break;
        if (result.status !== "pending" && result.status !== "processing") throw new TypeError("Invalid Vocu job status");
        await pause(pollIntervalMs, signal);
        result = await json(await api(`generate/${encodeURIComponent(id)}`));
      }
      completion = "generated";
      audioResponse = await send(audioUrl(object(result.metadata).audio), { method: "GET" });
    } else {
      // Request validation and mode checks exclude batches and saved splitters here.
      if (request.voice === undefined) throw new TypeError("Vocu synchronous synthesis requires a voice");
      const response = await api("simple-generate", { ...wireSpeech(request), flash: request.latencyOptimization === "maximum", srt: request.subtitleFormat === "srt", stream: true, direct_stream: mode === "stream" });
      if (mode === "http") {
        result = await json(response);
        audioResponse = await send(audioUrl(result.streamUrl ?? result.audio), { method: "GET" });
      } else audioResponse = response;
    }
    // Own the body before parsing optional headers, so malformed metadata also releases it.
    try {
      const header = audioResponse.headers.get("x-reecho-response-data");
      if (header !== null && result === undefined) {
        if (new TextEncoder().encode(header).byteLength > maxMetadataBytes) throw new TypeError("Vocu metadata exceeds maxMetadataBytes");
        result = object(metadata(header));
      }
      const type = audioResponse.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (type && type !== "audio/mpeg" && type !== "application/octet-stream") throw new TypeError("Vocu returned an unexpected audio content type");
      if (!audioResponse.body) throw new TypeError("Vocu returned no audio body");
      let received = false;
      for await (const chunk of bytes(audioResponse.body, signal, aborted)) { received = true; yield chunk; }
      if (!received) throw new TypeError("Vocu returned no audio");
    } finally { if (!audioResponse.body?.locked) void audioResponse.body?.cancel().catch(() => {}); }
    signal.throwIfAborted();
    yield { event: "done", completion, ...(result === undefined ? {} : { metadata: result }), ...(requestId === undefined ? {} : { requestId }) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    lifetime.abort();
  }
}
