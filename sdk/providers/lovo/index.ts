import type { TtsRequest } from "../../../schemas/providers/lovo/index.ts";
import type { Auth } from "../../auth.ts";
import { createSpeech, createSpeechJob, getSpeechJob, decodeCreateSpeech, decodeCreateSpeechJob, decodeGetSpeechJob,
  createSpeechStatus, createSpeechJobStatus, getSpeechJobStatus, defaultBaseUrl } from "../../generated/clients/lovo.ts";
import { requestDefaults, validateRequest } from "../../generated/validators/lovo.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/lovo/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  /** Sync waits for completion server-side first; async starts polling immediately. */
  readonly mode?: "sync" | "async";
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
export interface LovoAudioEnvelope {
  readonly correlation: "ordered";
  /** Job/output/asset identity. A new ID starts a separate audio file, not a continuation of the previous container. */
  readonly correlationId: string;
  readonly inputGroupId: string;
  readonly audio: Uint8Array;
  readonly timestamps: readonly [];
}
export class LovoError extends Error {
  readonly statusCode: number | null;
  readonly code: string | null;
  readonly jobId: string | null;
  readonly retryAfter: string | null;
  constructor(message: string, statusCode: number | null, code: string | null, jobId: string | null = null, retryAfter: string | null = null) {
    super(message); this.name = "LovoError"; this.statusCode = statusCode; this.code = code; this.jobId = jobId; this.retryAfter = retryAfter;
  }
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
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<LovoAudioEnvelope> {
  validateRequest(request);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.lovo?.apiKey ?? environment.SPEECHSWITCH_LOVO_API_KEY ?? environment.LOVO_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.lovo.apiKey configuration");
  const mode = options.mode ?? "sync"; const pollIntervalMs = options.pollIntervalMs ?? 1000; const timeoutMs = options.timeoutMs;
  if (mode !== "sync" && mode !== "async") throw new TypeError("Invalid LOVO mode");
  for (const value of [pollIntervalMs, timeoutMs]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)) throw new TypeError("LOVO polling interval and timeout must be integers between 0 and 2147483647");
  const fetch = options.fetch ?? globalThis.fetch; const baseUrl = options.baseUrl ?? defaultBaseUrl;
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("LOVO synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void; const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("LOVO synthesis deadline expired", "TimeoutError")), timeoutMs);
  const client = { apiKey, baseUrl, fetch, signal };
  const response = async (pending: Promise<Response>): Promise<Response> => {
    // A custom fetch may ignore abort and resolve after our deadline.
    void pending.then(value => { if (signal.aborted) void value.body?.cancel().catch(() => {}); }, () => {});
    return Promise.race([pending, aborted]);
  };
  const json = async (pending: Promise<Response>, status: number): Promise<unknown> => {
    const result = await response(pending); const text = await bodyText(result, signal, aborted);
    if (result.status !== status) throw new LovoError(text || `LOVO returned HTTP ${result.status}; expected ${status}`, result.status, null, null, result.headers.get("retry-after"));
    return JSON.parse(text);
  };
  try {
    const input = { text: request.text, speaker: request.voice, speed: request.speed ?? requestDefaults.speed,
      ...(request.voiceStyle === undefined ? {} : { speakerStyle: request.voiceStyle }) };
    let completed = mode === "sync" ? decodeCreateSpeech(await json(createSpeech(input, client), createSpeechStatus)) : undefined;
    let job = completed ?? decodeCreateSpeechJob(await json(createSpeechJob(input, client), createSpeechJobStatus));
    const id = job.id;
    if (!id || id === "." || id === "..") throw new TypeError("LOVO returned an invalid job ID");
    for (;;) {
      if (job.id !== id) throw new TypeError("LOVO returned a different job ID while polling");
      if (job.type !== "tts" && job.type !== "simple_tts") throw new TypeError("LOVO returned a non-TTS job");
      if (job.error) throw new LovoError(job.error.message, null, job.error.code, id);
      if (job.status === "done") break;
      await delay(pollIntervalMs, signal);
      completed = decodeGetSpeechJob(await json(getSpeechJob({ jobId: id }, client), getSpeechJobStatus)); job = completed;
    }
    // The async creation response deliberately lacks data, even if already done.
    if (!completed) completed = decodeGetSpeechJob(await json(getSpeechJob({ jobId: id }, client), getSpeechJobStatus));
    job = completed;
    if (job.id !== id || job.status !== "done" || (job.type !== "tts" && job.type !== "simple_tts")) throw new TypeError("LOVO returned an inconsistent completed job");
    if (job.error) throw new LovoError(job.error.message, null, job.error.code, id);
    const outputs = completed.data;
    if (!outputs?.length) throw new TypeError("LOVO completed without audio outputs");
    const assets: { url: URL; output: number; index: number }[] = [];
    // Validate the whole result before yielding any bytes, so a later failed
    // output cannot masquerade as a successfully completed partial synthesis.
    outputs.forEach((output, outputIndex) => {
      if (output.error) throw new LovoError(output.error.message, null, output.error.code, id);
      if (output.status === "failed") throw new LovoError("LOVO speech output failed", null, null, id);
      if (output.status !== "succeeded" || !output.urls?.length) throw new TypeError("LOVO completed without usable audio URLs");
      output.urls.forEach((value, index) => {
        const url = new URL(value);
        // Allow HTTP only on the explicitly configured API origin (e.g. a local
        // test proxy). Provider-hosted assets must use credential-free HTTPS.
        if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && url.origin === new URL(baseUrl).origin))) throw new TypeError("LOVO returned an unsafe audio URL");
        assets.push({ url, output: outputIndex, index });
      });
    });
    for (const asset of assets) {
      signal.throwIfAborted();
      // Never forward the API key or browser cookies to provider-supplied URLs.
      const result = await response(fetch(asset.url, { method: "GET", signal, credentials: "omit", redirect: "error" }));
      if (!result.ok) throw new LovoError(await bodyText(result, signal, aborted) || `LOVO audio download returned HTTP ${result.status}`, result.status, null, id, result.headers.get("retry-after"));
      if (!result.body) throw new TypeError("LOVO audio download returned no stream");
      for await (const audio of bytes(result.body, signal, aborted)) yield {
        correlation: "ordered", correlationId: `${id}:${asset.output}:${asset.index}`, inputGroupId: `${id}:${asset.output}`, audio, timestamps: [],
      };
    }
  } finally { if (timer !== undefined) clearTimeout(timer); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
