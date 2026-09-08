import type { TtsRequest, SynthesisItem, TimelineOutput, SegmentTimestamp } from "../../../schemas/providers/fish/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import { validateRequest } from "../../generated/validators/fish.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { decodeMessagePack, encodeMessagePack } from "../../runtime/msgpack.ts";
import { serverSentEvents } from "../../runtime/sse.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest } from "../../../schemas/providers/fish/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
  /** Deadline for the whole operation, including input and network waits. */
  readonly timeoutMs?: number;
}

export class FishError extends Error {
  readonly statusCode: number;
  readonly reason: string | null;
  constructor(statusCode: number, message: string, reason: string | null) {
    super(`Fish ${statusCode}: ${message}`);
    this.name = "FishError"; this.statusCode = statusCode; this.reason = reason;
  }
}

// The OpenAPI omits the successful /v1/tts audio response and describes binary
// references as JSON strings. Implement the documented MessagePack wire directly.
interface WireRequest {
  readonly text: string;
  readonly reference_id: string | readonly string[] | null;
  readonly references: readonly { readonly audio: Uint8Array; readonly text: string }[] | readonly (readonly { readonly audio: Uint8Array; readonly text: string }[])[] | null;
  readonly format: "mp3" | "wav" | "pcm" | "opus";
  readonly sample_rate: number;
  readonly mp3_bitrate: number;
  readonly opus_bitrate: number;
  readonly prosody: { readonly speed: number; readonly volume: number; readonly normalize_loudness: boolean };
  readonly temperature: number;
  readonly top_p: number;
  readonly chunk_length: number;
  readonly min_chunk_length: number;
  readonly max_new_tokens: number;
  readonly repetition_penalty: number;
  readonly condition_on_previous_chunks: boolean;
  readonly early_stop_threshold: number;
  readonly normalize: boolean;
  readonly latency: "normal" | "balanced" | "low";
  readonly features: readonly string[];
}
type Input = string | { readonly command: "flush" };
type ClientMessage = { readonly event: "start"; readonly request: WireRequest } | { readonly event: "text"; readonly text: string } | { readonly event: "flush" | "stop" };
type Packet = { readonly event: "audio"; readonly audio: Uint8Array } | { readonly event: "finish"; readonly reason: "stop" | "error" } | { readonly event: "ignored" };

function settings(request: TtsRequest): WireRequest {
  const speakers = request.speakers;
  return {
    text: typeof request.text === "string" ? request.text : "",
    reference_id: speakers ? speakers.map((speaker, index) => speaker.voice ?? String(index)) : request.voice ?? null,
    references: speakers ? speakers[0]?.referenceSamples ? speakers.map(speaker => speaker.referenceSamples!) : null : request.referenceSamples ?? null,
    format: request.output.format === "ogg_opus" ? "opus" : request.output.format,
    sample_rate: request.output.sampleRateHz ?? (request.output.format === "ogg_opus" ? 48000 : 44100),
    mp3_bitrate: request.output.format === "mp3" ? (request.output.bitRateBps ?? 128000) / 1000 : 128,
    opus_bitrate: request.output.format === "ogg_opus" ? request.output.bitRateBps ?? -1000 : -1000,
    prosody: { speed: request.speed ?? 1, volume: request.volumeDb ?? 0, normalize_loudness: request.loudnessNormalization ?? true },
    temperature: request.temperature ?? 0.7, top_p: request.topP ?? 0.7,
    chunk_length: request.textChunkLength ?? 300, min_chunk_length: request.minTextChunkLength ?? 50,
    max_new_tokens: request.maxAudioTokens ?? 1024, repetition_penalty: request.repetitionPenalty ?? 1.2,
    condition_on_previous_chunks: request.conditionOnPreviousChunks ?? true, early_stop_threshold: request.earlyStopThreshold ?? 1,
    normalize: request.textNormalization ?? true,
    latency: ({ none: "normal", moderate: "balanced", aggressive: "low" } as const)[request.latencyOptimization ?? "none"],
    features: request.features ?? [],
  };
}

function decodePacket(data: unknown): Packet {
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new TypeError("Fish returned a non-binary WebSocket frame");
  const value = decodeMessagePack(data);
  if (value && typeof value === "object" && "event" in value) {
    if (value.event === "audio" && "audio" in value && value.audio instanceof Uint8Array) return { event: "audio", audio: value.audio };
    if (value.event === "finish" && "reason" in value && (value.reason === "stop" || value.reason === "error")) return { event: "finish", reason: value.reason };
    // The protocol explicitly permits future event names; known malformed events still fail.
    if (typeof value.event === "string" && value.event !== "audio" && value.event !== "finish") return { event: "ignored" };
  }
  throw new TypeError("Fish returned an invalid WebSocket event");
}

async function* streaming(text: AsyncIterable<Input>, wire: WireRequest, socket: WebSocketLike, signal: AbortSignal, validateInput: (value: unknown) => void): AsyncIterableIterator<Uint8Array> {
  const connection = await connectWebSocket({ socket, signal, encode: (message: ClientMessage) => encodeMessagePack(message), decode: decodePacket });
  let source: AsyncIterator<Input>;
  try { source = text[Symbol.asyncIterator](); } catch (error) { connection.close(); throw error; }
  let inputDone = false; let stopped = false;
  const stopInput = () => {
    if (inputDone || stopped) return;
    stopped = true;
    // Cancellation cannot wait for an uncooperative producer's pending next().
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  try {
    signal.throwIfAborted();
    connection.send({ event: "start", request: wire });
    const nextInput = () => Promise.resolve().then(() => { signal.throwIfAborted(); return source.next(); }).then(
      value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }),
    );
    const nextOutput = () => connection.messages.next().then(
      value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }),
    );
    let pendingInput = nextInput(); let pendingOutput = nextOutput(); let preferInput = true;
    for (;;) {
      const event = await (inputDone ? pendingOutput : Promise.race(preferInput ? [pendingInput, pendingOutput] : [pendingOutput, pendingInput]));
      signal.throwIfAborted(); preferInput = !preferInput;
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        if (event.value.done) { inputDone = true; connection.send({ event: "stop" }); }
        else {
          const value = event.value.value; validateInput(value);
          connection.send(typeof value === "string" ? { event: "text", text: value } : { event: "flush" });
          pendingInput = nextInput();
        }
      } else {
        if (event.value.done) throw new TypeError("Fish WebSocket closed before session completion");
        const packet = event.value.value;
        if (packet.event === "finish") {
          if (packet.reason === "error") throw new FishError(0, "Streaming synthesis failed", "error");
          if (!inputDone) throw new TypeError("Fish finished before the input stream ended");
          return;
        }
        if (packet.event === "audio") yield packet.audio;
        pendingOutput = nextOutput();
      }
    }
  } finally {
    signal.removeEventListener("abort", stopInput); stopInput(); connection.close();
  }
}

function alignment(data: string): TimelineOutput {
  const parsed: unknown = JSON.parse(data);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Fish returned an invalid timestamp event");
  const value = parsed as Record<string, unknown>;
  if (typeof value.audio_base64 !== "string" || typeof value.content !== "string" || typeof value.chunk_seq !== "number" || !Number.isSafeInteger(value.chunk_seq) || value.chunk_seq < 0 || typeof value.chunk_audio_offset_sec !== "number" || !Number.isFinite(value.chunk_audio_offset_sec) || value.chunk_audio_offset_sec < 0) throw new TypeError("Fish returned an invalid timestamp event");
  const common = {
    correlation: "timeline" as const, correlationId: String(value.chunk_seq),
    timelineOffsetMs: value.chunk_audio_offset_sec * 1000, audio: decodeBase64(value.audio_base64),
  };
  if (!Number.isFinite(common.timelineOffsetMs)) throw new TypeError("Fish returned an invalid timestamp event");
  if (value.alignment === null) return { ...common, timestamps: [] };
  if (!value.alignment || typeof value.alignment !== "object" || Array.isArray(value.alignment)) throw new TypeError("Fish returned an invalid alignment snapshot");
  const snapshot = value.alignment as Record<string, unknown>;
  if (!Array.isArray(snapshot.segments) || typeof snapshot.audio_duration !== "number" || !Number.isFinite(snapshot.audio_duration * 1000) || snapshot.audio_duration < 0) throw new TypeError("Fish returned an invalid alignment snapshot");
  const timestamps = snapshot.segments.map((item: unknown): SegmentTimestamp => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("Fish returned an invalid timing segment");
    const segment = item as Record<string, unknown>;
    if (typeof segment.text !== "string" || typeof segment.start !== "number" || typeof segment.end !== "number" || !Number.isFinite(segment.start * 1000) || !Number.isFinite(segment.end * 1000) || segment.start < 0 || segment.end < segment.start) throw new TypeError("Fish returned an invalid timing segment");
    return { kind: "segment", value: segment.text, startTimeMs: segment.start * 1000, endTimeMs: segment.end * 1000 };
  });
  // Repeated snapshots may revise earlier timing. Never append or associate
  // the full snapshot solely with this event's incremental audio bytes.
  return { ...common, timestamps, timestampUpdate: "replace", durationMs: snapshot.audio_duration * 1000 };
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<SynthesisItem> {
  const validateInput = validateRequest(request);
  // Byte-array bounds are not yet representable by the schema annotations.
  const groups = request.speakers ? request.speakers.map(speaker => speaker.referenceSamples) : [request.referenceSamples];
  for (const group of groups) {
    if (group?.some(sample => sample.audio.byteLength === 0)) throw new TypeError("Fish reference audio must not be empty");
  }
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted();
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Fish timeoutMs must be an integer between 0 and 2147483647");
  if (timeoutMs === 0) throw new DOMException("Fish synthesis deadline expired", "TimeoutError");
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.fish?.apiKey ?? environment.SPEECHSWITCH_FISH_API_KEY ?? environment.FISH_API_KEY;
  if (!apiKey && !options.webSocket) throw new TypeError("Missing auth.fish.apiKey configuration");
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://api.fish.audio";
  const wire = settings(request);
  const timeout = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Fish synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    if (typeof request.text !== "string") {
      let socket = options.webSocket;
      if (!socket) {
        if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("Fish native WebSocket authentication requires Node or Bun; inject an authenticated WebSocket in browsers");
        const url = new URL(options.webSocketUrl ?? baseUrl);
        if (!options.webSocketUrl) { url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/tts/live`; }
        // Node's bundled Undici and Bun accept headers; DOM types omit them.
        const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
        if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
        socket = new Constructor(url.href, { headers: { authorization: `Bearer ${apiKey}`, model: request.model } });
      }
      yield* streaming(request.text, wire, socket, signal, validateInput); return;
    }
    if (!apiKey) throw new TypeError("Missing auth.fish.apiKey configuration");
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/tts${request.timestampGranularity ? "/stream/with-timestamp" : ""}`;
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, model: request.model, "content-type": "application/msgpack" }, body: encodeMessagePack(wire), signal });
    if (!response.ok) {
      const body = await response.text(); let message = body; let reason: string | null = null;
      try { const parsed = JSON.parse(body); if (typeof parsed?.message === "string") message = parsed.message; if (typeof parsed?.reason === "string") reason = parsed.reason; } catch {}
      throw new FishError(response.status, message, reason);
    }
    if (!response.body) throw new TypeError("Fish returned no audio stream");
    if (request.timestampGranularity) {
      for await (const data of serverSentEvents(response.body)) { signal.throwIfAborted(); yield alignment(data); }
    } else {
      for await (const bytes of response.body) { signal.throwIfAborted(); yield bytes; }
    }
    signal.throwIfAborted();
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    lifetime.abort();
  }
}
