import type { TtsRequest } from "../../../schemas/providers/resemble/index.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { serverSentEvents } from "../../runtime/sse.ts";
import { requestDefaults, validateRequest } from "../../generated/validators/resemble.ts";

export type { TtsRequest } from "../../../schemas/providers/resemble/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Deployment root; any proxy path prefix is preserved. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface DoneEvent { readonly event: "done"; readonly requestId: string }
export class ResembleError extends Error {
  readonly statusCode: number | null;
  readonly body: string;
  readonly requestId: string | null;
  readonly retryAfter: string | null;
  constructor(statusCode: number | null, body: string, requestId: string | null, retryAfter: string | null = null) {
    super(statusCode === null ? "Resemble Chatterbox generation failed" : `Resemble Chatterbox returned HTTP ${statusCode}`);
    this.name = "ResembleError"; this.statusCode = statusCode; this.body = body;
    this.requestId = requestId; this.retryAfter = retryAfter;
  }
}

interface FileData {
  readonly path: string;
  readonly url?: string | null;
  readonly meta?: { readonly _type: "gradio.FileData" };
}
function fileData(value: unknown): FileData {
  if (!value || typeof value !== "object" || !("path" in value) || typeof value.path !== "string" || !value.path
    || ("url" in value && value.url !== null && typeof value.url !== "string")
    || ("is_stream" in value && value.is_stream !== false)
    || ("meta" in value && (!value.meta || typeof value.meta !== "object" || !("_type" in value.meta) || value.meta._type !== "gradio.FileData"))) {
    throw new TypeError("Resemble returned an invalid audio file");
  }
  return value as FileData;
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
      yield item.value;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array | DoneEvent> {
  validateRequest(request);
  const model = request.model ?? "chatterbox";
  const defaultHost = model === "chatterbox" ? "https://resembleai-chatterbox.hf.space"
    : model === "chatterbox-multilingual" ? "https://resembleai-chatterbox-multilingual-tts-v3.hf.space"
    : "https://resembleai-chatterbox-turbo-demo.hf.space";
  const base = new URL(options.baseUrl ?? defaultHost);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new TypeError("Invalid Resemble deployment URL");
  base.pathname = base.pathname.replace(/\/?$/, "/");
  const apiName = model === "chatterbox-turbo" ? "generate" : "generate_tts_audio";
  const environment = typeof process === "undefined" ? {} : process.env;
  const token = options.auth?.resemble?.token ?? environment.SPEECHSWITCH_RESEMBLE_TOKEN ?? environment.HF_TOKEN ?? "";
  const headers = new Headers(token ? { Authorization: `Bearer ${token}` } : {});
  const fetch = options.fetch ?? globalThis.fetch;
  const temperature = request.temperature ?? requestDefaults.temperature;
  const randomSeed = request.randomSeed ?? requestDefaults.randomSeed;
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Resemble timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted();
  if (timeoutMs === 0) throw new DOMException("Resemble synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Resemble synthesis deadline expired", "TimeoutError")), timeoutMs);
  let requestId: string | null = null;
  function endpoint(path: string): URL {
    const url = new URL(base); url.pathname = url.pathname.replace(/\/$/, "") + `/gradio_api/${path}`; return url;
  }
  async function text(response: Response): Promise<string> {
    if (!response.body) return "";
    const decoder = new TextDecoder(); let result = "";
    for await (const chunk of bytes(response.body, signal, aborted)) result += decoder.decode(chunk, { stream: true });
    return result + decoder.decode();
  }
  async function send(url: URL, init: RequestInit): Promise<Response> {
    signal.throwIfAborted();
    const pending = fetch(url, { ...init, signal, redirect: "error", credentials: "omit" });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    if (!response.ok) throw new ResembleError(response.status, await text(response), requestId, response.headers.get("retry-after"));
    return response;
  }
  try {
    let reference: FileData | null = null;
    if (request.referenceAudio !== undefined) {
      const form = new FormData();
      // Reference bytes are encoded audio, not assumed to be WAV or raw PCM.
      form.append("files", new Blob([Uint8Array.from(request.referenceAudio)], { type: "application/octet-stream" }), "reference.audio");
      const uploaded: unknown = JSON.parse(await text(await send(endpoint("upload"), { method: "POST", headers, body: form })));
      if (!Array.isArray(uploaded) || uploaded.length !== 1 || typeof uploaded[0] !== "string" || !uploaded[0]) throw new TypeError("Resemble returned an invalid upload path");
      reference = { path: uploaded[0], meta: { _type: "gradio.FileData" } };
    } else if (model === "chatterbox-turbo") {
      // Only resolve the live example recording here: cached /tmp paths are not
      // stable defaults. The manifest does not build operations at runtime.
      const info: unknown = JSON.parse(await text(await send(endpoint("info"), { method: "GET", headers })));
      if (!info || typeof info !== "object" || !("named_endpoints" in info)) throw new TypeError("Resemble returned no default reference recording");
      const endpoints = info.named_endpoints;
      if (!endpoints || typeof endpoints !== "object" || !("/generate" in endpoints)) throw new TypeError("Resemble returned no default reference recording");
      const generate = endpoints["/generate"];
      if (!generate || typeof generate !== "object" || !("parameters" in generate) || !Array.isArray(generate.parameters)) throw new TypeError("Resemble returned no default reference recording");
      const parameter: unknown = generate.parameters[1];
      if (!parameter || typeof parameter !== "object" || !("parameter_name" in parameter) || parameter.parameter_name !== "audio_prompt_path" || !("parameter_default" in parameter)) throw new TypeError("Resemble returned no default reference recording");
      const sample = fileData(parameter.parameter_default);
      // The info API overwrites file URLs with a generic example; its path is
      // the actual current cached recording, confirmed by /config.
      reference = { path: sample.path, meta: { _type: "gradio.FileData" } };
    }
    const data = request.model === "chatterbox-turbo"
      ? [request.text, reference, temperature, randomSeed, request.minP ?? 0, request.topP ?? 0.95, request.topK ?? 1000, request.repetitionPenalty ?? 1.2, request.loudnessNormalization ?? true]
      : request.model === "chatterbox-multilingual"
        ? [request.text, reference, request.language ?? "en", request.styleExaggeration ?? 0.5, temperature, randomSeed, request.voiceGuidance ?? 0.5]
        : [request.text, reference, request.styleExaggeration ?? 0.5, temperature, randomSeed, request.voiceGuidance ?? 0.5, request.referenceAudioTrimming ?? false];
    const jsonHeaders = new Headers(headers); jsonHeaders.set("Content-Type", "application/json");
    const submitted: unknown = JSON.parse(await text(await send(endpoint(`call/${apiName}`), { method: "POST", headers: jsonHeaders, body: JSON.stringify({ data }) })));
    if (!submitted || typeof submitted !== "object" || !("event_id" in submitted) || typeof submitted.event_id !== "string" || !submitted.event_id || submitted.event_id === "." || submitted.event_id === "..") throw new TypeError("Resemble returned an invalid event ID");
    requestId = submitted.event_id;
    const response = await send(endpoint(`call/${apiName}/${encodeURIComponent(requestId)}`), { method: "GET", headers });
    let file: FileData | undefined;
    try {
      if (!response.body || response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/event-stream") throw new TypeError("Resemble returned no event stream");
      for await (const message of serverSentEvents(bytes(response.body, signal, aborted), true)) {
        if (message.event === "heartbeat") continue;
        if (message.event === "error") throw new ResembleError(null, message.data, requestId);
        if (message.event !== "complete") throw new TypeError(`Unexpected Resemble event: ${message.event}`);
        const output: unknown = JSON.parse(message.data);
        if (!Array.isArray(output) || output.length !== 1) throw new TypeError("Resemble returned an invalid output list");
        file = fileData(output[0]); break;
      }
    } finally { if (!response.body?.locked) void response.body?.cancel().catch(() => {}); }
    if (!file) throw new TypeError("Resemble event stream ended before completion");
    const url = file.url ? new URL(file.url, base) : endpoint(`file=${encodeURIComponent(file.path)}`);
    if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && url.origin === base.origin))) throw new TypeError("Resemble returned an unsafe audio URL");
    // A deployment may store audio off-origin. Never forward its HF token there.
    const audio = await send(url, { method: "GET", headers: url.origin === base.origin ? headers : new Headers() });
    try {
      const contentType = audio.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!audio.body || (contentType && contentType !== "application/octet-stream" && !contentType.startsWith("audio/"))) throw new TypeError("Resemble returned no audio stream");
      let received = false;
      for await (const chunk of bytes(audio.body, signal, aborted)) if (chunk.byteLength) { received = true; yield chunk; }
      if (!received) throw new TypeError("Resemble returned empty audio");
      yield { event: "done", requestId };
    } finally { if (!audio.body?.locked) void audio.body?.cancel().catch(() => {}); }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", abort); lifetime.abort();
  }
}
