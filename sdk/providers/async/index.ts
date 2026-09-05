import type { TtsRequest } from "../../../schemas/providers/async/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest } from "../../../schemas/providers/async/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

interface Configuration {
  readonly apiKey: string;
  readonly fetch: Fetch;
  readonly baseUrl: string;
  readonly signal: AbortSignal;
}

// The export has incomplete response schemas and no WebSocket contract. Keep the
// protocol authored here; the unchanged reference snapshots are in schemas/sources/async.
interface WireSettings {
  readonly model_id: "async_flash_v1.0" | "async_flash_v1.5" | "async_pro_v1.0";
  readonly voice: { readonly mode: "id"; readonly id: string };
  readonly output_format:
    | { readonly container: "mp3"; readonly sample_rate: number; readonly bit_rate: number }
    | { readonly container: "raw" | "wav"; readonly sample_rate: number; readonly encoding: "pcm_s16le" | "pcm_f32le" | "pcm_mulaw" };
  readonly language: string | undefined;
  readonly speed_control: number | undefined;
  readonly stability: number | undefined;
}
type ClientMessage =
  | WireSettings
  | { readonly context_id: string; readonly transcript: string; readonly force: boolean }
  | { readonly context_id: string; readonly transcript: ""; readonly close_context: true };
type ServerMessage =
  | { readonly context_id: string; readonly audio: string; readonly final: boolean }
  | { readonly error_code: string; readonly message: string };

function settings(request: TtsRequest): WireSettings {
  const { output } = request;
  if (!Number.isInteger(output.sampleRateHz) || output.sampleRateHz < 8000 || output.sampleRateHz > 48000) {
    throw new TypeError("Async sampleRateHz must be an integer from 8000 to 48000");
  }
  if (output.format === "mp3" && output.bitRateBps !== undefined
    && (!Number.isInteger(output.bitRateBps) || output.bitRateBps < 32000 || output.bitRateBps > 320000)) {
    throw new TypeError("Async bitRateBps must be an integer from 32000 to 320000");
  }
  if (request.stability !== undefined
    && (!Number.isFinite(request.stability) || request.stability < 0 || request.stability > 1)) {
    throw new TypeError("Async stability must be between 0 and 1");
  }
  if (request.speed !== undefined && (!Number.isFinite(request.speed) || request.speed < 0.7 || request.speed > 2)) {
    throw new TypeError("Async speed must be between 0.7 and 2");
  }
  return {
    model_id: ({ "castleflow-1.0": "async_flash_v1.0", "flash_v1.5": "async_flash_v1.5", "pro_v1.0": "async_pro_v1.0" } as const)[request.model],
    voice: { mode: "id", id: request.voice },
    output_format: output.format === "mp3"
      ? { container: "mp3", sample_rate: output.sampleRateHz, bit_rate: output.bitRateBps ?? 192000 }
      : {
          container: output.format === "wav" ? "wav" : "raw",
          sample_rate: output.sampleRateHz,
          encoding: output.format === "mulaw" ? "pcm_mulaw" : output.sampleEncoding === "float_32" ? "pcm_f32le" : "pcm_s16le",
        },
    language: request.language,
    speed_control: request.speed,
    stability: request.stability === undefined ? undefined : Math.round(request.stability * 100),
  };
}

function decodeMessage(data: unknown): ServerMessage {
  if (typeof data !== "string") throw new TypeError("Async returned a non-text WebSocket frame");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Async returned an invalid WebSocket message");
  const message = value as Record<string, unknown>;
  if (typeof message.error_code === "string" && typeof message.message === "string") {
    return { error_code: message.error_code, message: message.message };
  }
  if (typeof message.context_id === "string" && typeof message.audio === "string" && typeof message.final === "boolean") {
    return { context_id: message.context_id, audio: message.audio, final: message.final };
  }
  throw new TypeError("Async returned an unknown WebSocket message");
}

async function* incremental(
  text: AsyncIterable<string>,
  wire: WireSettings,
  socket: WebSocketLike,
  force: boolean,
  signal: AbortSignal,
): AsyncIterableIterator<Uint8Array> {
  const contextId = globalThis.crypto.randomUUID();
  const connection = await connectWebSocket({ socket, signal, encode: (message: ClientMessage) => JSON.stringify(message), decode: decodeMessage });
  let source: AsyncIterator<string>;
  try { source = text[Symbol.asyncIterator](); }
  catch (error) { connection.close(); throw error; }
  let inputDone = false;
  let contextStarted = false;
  let inputStopped = false;
  const stopInput = () => {
    if (inputStopped || inputDone) return;
    inputStopped = true;
    // An async generator's return() can wait behind a pending next(). Request
    // cleanup without allowing an uncooperative producer to block cancellation.
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  try {
    signal.throwIfAborted();
    connection.send(wire);
    const nextInput = () => Promise.resolve().then(() => source.next()).then(
      value => ({ kind: "input" as const, value }),
      error => ({ kind: "error" as const, error }),
    );
    const nextOutput = () => connection.messages.next().then(
      value => ({ kind: "output" as const, value }),
      error => ({ kind: "error" as const, error }),
    );
    let pendingInput = nextInput();
    let pendingOutput = nextOutput();
    for (;;) {
      const event = await (inputDone ? pendingOutput : Promise.race([pendingOutput, pendingInput]));
      signal.throwIfAborted();
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        if (event.value.done) {
          inputDone = true;
          if (!contextStarted) return;
          connection.send({ context_id: contextId, transcript: "", close_context: true });
        } else {
          if (typeof event.value.value !== "string") throw new TypeError("Async streaming input supports text only");
          if (event.value.value.length) {
            contextStarted = true;
            connection.send({ context_id: contextId, transcript: `${event.value.value.replace(/\s+$/u, "")} `, force });
          }
          pendingInput = nextInput();
        }
      } else {
        if (event.value.done) throw new TypeError("Async WebSocket closed before final output");
        const message = event.value.value;
        if ("error_code" in message) throw new TypeError(`Async synthesis failed (${message.error_code}): ${message.message}`);
        if (message.context_id !== contextId) throw new TypeError("Async returned output for an unexpected context");
        if (message.final && !inputDone) throw new TypeError("Async finalized the context before input completed");
        if (message.audio) yield decodeBase64(message.audio);
        if (message.final) return;
        pendingOutput = nextOutput();
      }
    }
  } finally {
    signal.removeEventListener("abort", stopInput);
    stopInput();
    connection.close();
  }
}

const quotaMarker = new TextEncoder().encode("--ERROR:QUOTA_EXCEEDED--");

async function* audio(body: ReadableStream<Uint8Array>, checkQuota: boolean, signal: AbortSignal): AsyncIterableIterator<Uint8Array> {
  let pending = new Uint8Array();
  for await (const chunk of body) {
    signal.throwIfAborted();
    if (!checkQuota) { yield chunk; continue; }
    const bytes = pending.length ? new Uint8Array(pending.length + chunk.length) : chunk;
    if (pending.length) {
      bytes.set(pending);
      bytes.set(chunk, pending.length);
    }
    let marker = -1;
    for (let index = 0; index <= bytes.length - quotaMarker.length; index++) {
      if (bytes[index] === quotaMarker[0] && quotaMarker.every((byte, offset) => bytes[index + offset] === byte)) { marker = index; break; }
    }
    if (marker >= 0) {
      if (marker) yield bytes.subarray(0, marker);
      throw new TypeError("Async streaming quota exceeded");
    }
    // Retain only a possible marker prefix; ordinary audio is yielded immediately.
    let retained = Math.min(bytes.length, quotaMarker.length - 1);
    while (retained > 0 && !quotaMarker.subarray(0, retained).every((byte, index) => byte === bytes[bytes.length - retained + index])) retained--;
    const safe = bytes.length - retained;
    if (safe) yield bytes.subarray(0, safe);
    pending = bytes.slice(safe);
  }
  signal.throwIfAborted();
  if (pending.length) yield pending;
}

function timestamped(value: unknown): SynthesisEnvelope<Timestamp<"word">> {
  if (!value || typeof value !== "object") throw new TypeError("Async returned an invalid timestamp response");
  const response = value as Record<string, unknown>;
  if (typeof response.audio_base64 !== "string" || !response.alignment || typeof response.alignment !== "object") {
    throw new TypeError("Async returned incomplete timestamped audio");
  }
  const alignment = response.alignment as Record<string, unknown>;
  const words = alignment.words;
  const starts = alignment.word_start_times_milliseconds;
  const ends = alignment.word_end_times_milliseconds;
  if (!Array.isArray(words) || !Array.isArray(starts) || !Array.isArray(ends)
    || words.length !== starts.length || words.length !== ends.length) {
    throw new TypeError("Async returned mismatched word timestamp arrays");
  }
  const timestamps = words.map((word: unknown, index) => {
    const start: unknown = starts[index];
    const end: unknown = ends[index];
    if (typeof word !== "string" || typeof start !== "number" || !Number.isFinite(start) || start < 0
      || typeof end !== "number" || !Number.isFinite(end) || end < start) {
      throw new TypeError("Async returned an invalid word timestamp");
    }
    return { kind: "word" as const, value: word, startTimeMs: start, endTimeMs: end };
  });
  return { correlation: "chunk", audio: decodeBase64(response.audio_base64), timestamps };
}

async function* http(request: TtsRequest, text: string, wire: WireSettings, config: Configuration): AsyncIterableIterator<Uint8Array | SynthesisEnvelope<Timestamp<"word">>> {
  const path = request.timestampGranularity === "word" ? "/text_to_speech/with_timestamps"
    : request.output.format === "wav" ? "/text_to_speech" : "/text_to_speech/streaming";
  const response = await config.fetch(new URL(path, config.baseUrl), {
    method: "POST",
    headers: { "x-api-key": config.apiKey, version: "v1", "content-type": "application/json" },
    body: JSON.stringify({ ...wire, transcript: text }),
    signal: config.signal,
  });
  if (!response.ok) throw new TypeError(`Async returned HTTP ${response.status}: ${(await response.text()).trim()}`);
  if (request.timestampGranularity === "word") {
    const value: unknown = await response.json();
    config.signal.throwIfAborted();
    yield timestamped(value);
  } else {
    if (!response.body) throw new TypeError("Async returned no audio stream");
    yield* audio(response.body, path === "/text_to_speech/streaming", config.signal);
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array | SynthesisEnvelope<Timestamp<"word">>> {
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.async?.apiKey ?? environment.SPEECHSWITCH_ASYNC_API_KEY ?? environment.ASYNC_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.async.apiKey configuration");
  const wire = settings(request);
  if (typeof request.text === "string") {
    yield* http(request, request.text, wire, { apiKey, fetch: options.fetch ?? globalThis.fetch, baseUrl: options.baseUrl ?? "https://api.async.com", signal });
  } else {
    const url = new URL(options.webSocketUrl ?? "wss://api.async.com/text_to_speech/websocket/ws");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("version", "v1");
    const socket = options.webSocket ?? new globalThis.WebSocket(url.href);
    yield* incremental(request.text, wire, socket, request.segmentation === "immediate", signal);
  }
}
