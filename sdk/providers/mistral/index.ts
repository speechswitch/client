import type { DoneEvent, TtsRequest } from "../../../schemas/providers/mistral/index.ts";
import type { Auth } from "../../auth.ts";
import { encodeBase64 } from "../../base64.ts";
import { validateRequest, requestDefaults } from "../../generated/validators/mistral.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { serverSentEvents } from "../../runtime/sse.ts";
import { decodeEvent, decodeJson, MistralError, type Usage } from "./protocol.ts";

export type { TtsRequest, JsonValue } from "../../../schemas/providers/mistral/index.ts";
export { MistralError } from "./protocol.ts";
export type { Usage, PromptTokensDetails } from "./protocol.ts";
export type { DoneEvent } from "../../../schemas/providers/mistral/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

// The checked-in spec is stale; the docs download also contains unresolved
// root $defs pointers. Use the documented protocol, never a repaired spec.
export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array | DoneEvent> {
  validateRequest(request);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.mistral?.apiKey ?? environment.SPEECHSWITCH_MISTRAL_API_KEY ?? environment.MISTRAL_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.mistral.apiKey configuration");
  const url = new URL(options.baseUrl ?? "https://api.mistral.ai"); url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/audio/speech`;
  const fetch = options.fetch ?? globalThis.fetch;
  const body = JSON.stringify({ model: request.model ?? requestDefaults.model, input: request.text, stream: true, response_format: request.output?.format ?? "pcm",
    ...(request.voice === undefined ? {} : { voice_id: request.voice }),
    ...(request.referenceAudio === undefined ? {} : { ref_audio: encodeBase64(request.referenceAudio) }),
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    ...(request.promptCacheKey === undefined ? {} : { prompt_cache_key: request.promptCacheKey }) });
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Mistral timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("Mistral synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Mistral synthesis deadline expired", "TimeoutError")), timeoutMs);
  let response: Response | undefined;
  try {
    const pending = fetch(url, { method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream, application/json" }, body });
    void pending.then(result => { if (signal.aborted) void result.body?.cancel().catch(() => {}); }, () => {});
    response = await Promise.race([pending, aborted]); signal.throwIfAborted();
    if (!response.body) throw new MistralError(response.status, "Missing response body", response.headers.get("retry-after"));
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    async function* bytes() {
      for (;;) {
        signal.throwIfAborted(); const item = await Promise.race([reader.read(), aborted]); signal.throwIfAborted();
        if (item.done) return; yield item.value;
      }
    }
    try {
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!response.ok || contentType === "application/json") {
        let text = ""; const decoder = new TextDecoder();
        for await (const chunk of bytes()) text += decoder.decode(chunk, { stream: true }); text += decoder.decode();
        if (!response.ok) throw new MistralError(response.status, text, response.headers.get("retry-after"));
        const audio = decodeJson(JSON.parse(text));
        if (!audio.byteLength) throw new TypeError("Mistral returned no audio");
        yield audio; yield { event: "done" }; return;
      }
      if (contentType !== "text/event-stream") throw new TypeError("Mistral returned an unsupported response content type");
      let receivedAudio = false;
      for await (const message of serverSentEvents(bytes(), true)) {
        const packet = decodeEvent(message);
        if (packet.event === "audio") {
          if (packet.audio.byteLength) { receivedAudio = true; yield packet.audio; }
        } else {
          if (!receivedAudio) throw new TypeError("Mistral returned no audio");
          yield { event: "done", usage: packet.usage }; return;
        }
      }
      throw new TypeError("Mistral speech stream ended before speech.audio.done");
    } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  } finally {
    if (timer !== undefined) clearTimeout(timer); signal.removeEventListener("abort", abort); lifetime.abort();
    if (!response?.body?.locked) void response?.body?.cancel().catch(() => {});
  }
}
