import type { TtsRequest } from "../../../schemas/providers/openai/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import { createSpeech, decodeSpeechEvent, defaultBaseUrl, speechStatus } from "../../generated/clients/openai.ts";
import { validateRequest } from "../../generated/validators/openai.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { serverSentEvents } from "../../runtime/sse.ts";

export type { TtsRequest } from "../../../schemas/providers/openai/index.ts";
export interface Usage { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number }
export interface DoneEvent { readonly event: "done"; readonly requestId?: string; readonly usage?: Usage }
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** API root including /v1, matching OpenAI's base URL semantics. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export class OpenaiError extends Error {
  readonly statusCode: number;
  readonly body: string;
  readonly requestId: string | null;
  readonly retryAfter: string | null;
  constructor(statusCode: number, body: string, requestId: string | null, retryAfter: string | null) {
    super(`OpenAI speech failed (${statusCode})`); this.name = "OpenaiError";
    this.statusCode = statusCode; this.body = body; this.requestId = requestId; this.retryAfter = retryAfter;
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array | DoneEvent> {
  validateRequest(request);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.openai?.apiKey ?? environment.SPEECHSWITCH_OPENAI_API_KEY ?? environment.OPENAI_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.openai.apiKey configuration");
  const fetch = options.fetch ?? globalThis.fetch; const baseUrl = options.baseUrl ?? defaultBaseUrl;
  const model = request.model ?? "tts-1";
  const input = { model, input: request.text, voice: request.voiceSource === "custom" ? { id: request.voice } : request.voice,
    response_format: request.output?.format ?? "pcm", speed: request.speed ?? 1, stream_format: request.includeUsage ? "sse" as const : "audio" as const,
    ...(request.instructions === undefined ? {} : { instructions: request.instructions }) };
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("OpenAI timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("OpenAI speech deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void; const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("OpenAI speech deadline expired", "TimeoutError")), timeoutMs);
  let response: Response | undefined;
  try {
    const pending = createSpeech(input, { apiKey, baseUrl, fetch, signal });
    void pending.then(result => { if (signal.aborted) void result.body?.cancel().catch(() => {}); }, () => {});
    response = await Promise.race([pending, aborted]); signal.throwIfAborted();
    const requestId = response.headers.get("x-request-id");
    if (!response.body) throw new OpenaiError(response.status, "Missing response body", requestId, response.headers.get("retry-after"));
    const reader = response.body.getReader(); const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    async function* bytes() {
      for (;;) { signal.throwIfAborted(); const item = await Promise.race([reader.read(), aborted]); signal.throwIfAborted(); if (item.done) return; yield item.value; }
    }
    try {
      if (response.status !== speechStatus) {
        const decoder = new TextDecoder(); let text = "";
        for await (const chunk of bytes()) text += decoder.decode(chunk, { stream: true });
        throw new OpenaiError(response.status, text + decoder.decode(), requestId, response.headers.get("retry-after"));
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      const identity = requestId === null ? {} : { requestId }; let receivedAudio = false;
      if (request.includeUsage) {
        if (contentType !== "text/event-stream") throw new TypeError("OpenAI returned no SSE usage stream");
        for await (const message of serverSentEvents(bytes(), true)) {
          const event = decodeSpeechEvent(JSON.parse(message.data));
          if (message.event !== "message" && message.event !== event.type) throw new TypeError("OpenAI returned conflicting SSE event types");
          if (event.type === "speech.audio.delta") {
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.audio)) throw new TypeError("OpenAI returned invalid base64 audio");
            const audio = decodeBase64(event.audio); if (audio.byteLength) { receivedAudio = true; yield audio; }
          } else {
            if (!receivedAudio) throw new TypeError("OpenAI returned no audio");
            yield { event: "done", ...identity, usage: { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens, totalTokens: event.usage.total_tokens } }; return;
          }
        }
        throw new TypeError("OpenAI speech stream ended before speech.audio.done");
      }
      if (contentType && contentType !== "application/octet-stream" && !contentType.startsWith("audio/")) throw new TypeError("OpenAI returned a non-audio response");
      for await (const audio of bytes()) if (audio.byteLength) { receivedAudio = true; yield audio; }
      if (!receivedAudio) throw new TypeError("OpenAI returned no audio");
      yield { event: "done", ...identity };
    } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  } finally {
    if (timer !== undefined) clearTimeout(timer); signal.removeEventListener("abort", abort); lifetime.abort();
    if (!response?.body?.locked) void response?.body?.cancel().catch(() => {});
  }
}
