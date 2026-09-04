import type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/async/index.ts";
import {
  cloneVoice as requestCloneVoice,
  defaultBaseUrl,
  defaultWebSocketUrl,
  deleteVoice as requestDeleteVoice,
  getVoice as requestVoice,
  getVoices as requestVoices,
  listVoices as requestVoiceList,
  previewVoice as requestVoicePreview,
  synthesize as requestSpeech,
  updateVoice as requestUpdateVoice,
  type ClientOptions,
  type ClonedVoice,
  type Language,
  type Model,
  type OutputFormat,
  type TimestampResponse,
  type TtsInput,
  type Voice,
  type VoiceFilters,
  type VoiceList,
  type VoiceUpdate,
} from "../../generated/clients/async.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/async/index.ts";
export type { ClonedVoice, Voice, VoiceFilters, VoiceList, VoiceUpdate } from "../../generated/clients/async.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  /** Stable context identifier, primarily useful when tracing or testing WebSocket sessions. */
  readonly contextId?: string;
  readonly signal?: AbortSignal;
}

type ClientMessage =
  | Omit<TtsInput, "transcript">
  | { readonly context_id: string; readonly transcript: string; readonly force?: boolean }
  | { readonly context_id: string; readonly transcript: ""; readonly close_context: true }
  | { readonly terminate: true };
type ServerMessage =
  | { readonly context_id: string; readonly audio: string; readonly final: boolean }
  | { readonly error_code: string; readonly message: string; readonly extra?: unknown };

function environment(): Record<string, string | undefined> { return typeof process === "undefined" ? {} : process.env; }
function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.async?.apiKey ?? environment().SPEECHSWITCH_ASYNC_API_KEY ?? environment().ASYNC_API_KEY;
  if (!value) throw new TypeError("Missing auth.async.apiKey configuration");
  return value;
}
function client(options: SynthesizeOptions): ClientOptions {
  return { apiKey: apiKey(options), fetch: options.fetch ?? globalThis.fetch, baseUrl: options.baseUrl ?? defaultBaseUrl, signal: options.signal };
}
const wireModel = { "castleflow-1.0": "async_flash_v1.0", "flash_v1.5": "async_flash_v1.5", "pro_v1.0": "async_pro_v1.0" } as const;
function output(request: TtsRequest | TtsRequestWithTimestamps): OutputFormat {
  const value = request.output;
  if (value.format === "pcm") return { container: "raw", encoding: value.sampleEncoding === "float_32" ? "pcm_f32le" : "pcm_s16le", sample_rate: value.sampleRateHz };
  if (value.format === "mulaw") return { container: "raw", encoding: "pcm_mulaw", sample_rate: value.sampleRateHz };
  return { container: value.format, sample_rate: value.sampleRateHz, bit_rate: value.format === "mp3" ? value.bitRateBps : undefined };
}
function input(request: TtsRequest | TtsRequestWithTimestamps, transcript: string): TtsInput {
  return {
    model_id: wireModel[request.model] as Model,
    transcript,
    voice: { mode: "id", id: request.voice },
    output_format: output(request),
    language: request.language as Language | undefined,
    speed_control: request.speed,
    stability: request.voiceTuning?.stability,
  };
}
async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  const detail = (await response.text()).trim();
  throw new TypeError(`Async returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}
const quotaMarker = new TextEncoder().encode("--ERROR:QUOTA_EXCEEDED--");
function markerIndex(bytes: Uint8Array): number {
  outer: for (let index = 0; index <= bytes.length - quotaMarker.length; index++) {
    for (let offset = 0; offset < quotaMarker.length; offset++) if (bytes[index + offset] !== quotaMarker[offset]) continue outer;
    return index;
  }
  return -1;
}
async function* streamedAudio(body: ReadableStream<Uint8Array>): AsyncIterableIterator<Uint8Array> {
  let pending = new Uint8Array();
  for await (const chunk of body) {
    const combined = new Uint8Array(pending.length + chunk.length); combined.set(pending); combined.set(chunk, pending.length);
    const marker = markerIndex(combined);
    if (marker >= 0) {
      if (marker) yield combined.slice(0, marker);
      throw new TypeError("Async streaming quota exceeded");
    }
    const safeLength = combined.length - quotaMarker.length + 1;
    if (safeLength > 0) { yield combined.slice(0, safeLength); pending = combined.slice(safeLength); }
    else pending = combined;
  }
  if (pending.length) yield pending;
}

function socketUrl(options: SynthesizeOptions, key: string): URL {
  const url = new URL(options.webSocketUrl ?? defaultWebSocketUrl);
  url.searchParams.set("api_key", key);
  url.searchParams.set("version", "v1");
  return url;
}
function nativeSocket(url: URL): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (url: string) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url.href);
}
function decodeMessage(data: unknown): ServerMessage {
  if (typeof data !== "string") throw new TypeError("Async returned a non-text WebSocket message");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Async returned an invalid WebSocket message");
  const message = value as Record<string, unknown>;
  if (typeof message.error_code === "string" && typeof message.message === "string") return value as ServerMessage;
  if (typeof message.context_id === "string" && typeof message.audio === "string" && typeof message.final === "boolean") return value as ServerMessage;
  throw new TypeError("Async returned an unknown WebSocket message");
}
function transcript(value: string): string { return `${value.replace(/\s+$/u, "")} `; }

async function* webSocketSpeech(request: TtsRequest, textInput: AsyncIterable<string>, segmentation: "sentence" | "immediate" | undefined, options: SynthesizeOptions): AsyncIterableIterator<Uint8Array> {
  const iterator = textInput[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) return;
  const key = apiKey(options);
  const contextId = options.contextId ?? globalThis.crypto.randomUUID();
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket: options.webSocket ?? nativeSocket(socketUrl(options, key)),
    encode: JSON.stringify,
    decode: decodeMessage,
  });
  const configuration = input(request, "");
  const { transcript: _transcript, ...initialize } = configuration;
  const sending = (async () => {
    connection.send(initialize);
    connection.send({ context_id: contextId, transcript: transcript(first.value), force: segmentation === "immediate" || undefined });
    for (;;) {
      const value = await iterator.next();
      if (value.done) break;
      connection.send({ context_id: contextId, transcript: transcript(value.value), force: segmentation === "immediate" || undefined });
    }
    connection.send({ context_id: contextId, transcript: "", close_context: true });
  })();
  try {
    for await (const message of connection.messages) {
      if ("error_code" in message) throw new TypeError(`Async streaming synthesis failed (${message.error_code}): ${message.message}`);
      if (message.context_id !== contextId) throw new TypeError(`Async returned audio for unexpected context ${message.context_id}`);
      if (message.audio) yield decodeBase64(message.audio);
      if (message.final) { await sending; return; }
    }
    await sending;
    throw new TypeError("Async WebSocket closed before final output");
  } finally { connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text !== "string") { yield* webSocketSpeech(request, request.text, request.segmentation, options); return; }
  const mode = request.latencyOptimization === "none" ? "file" : "stream";
  const response = await checked(await requestSpeech(input(request, request.text), mode, client(options)));
  if (!response.body) throw new TypeError("Async returned no audio stream");
  if (mode === "stream") yield* streamedAudio(response.body);
  else yield* response.body;
}

export async function* synthesizeWithTimestamps(request: TtsRequestWithTimestamps, options: SynthesizeOptions = {}): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word">>> {
  const response = await checked(await requestSpeech(input(request, request.text), "timestamps", client(options)));
  const value = await response.json() as TimestampResponse;
  const alignment = value.alignment;
  if (alignment.words.length !== alignment.word_start_times_milliseconds.length || alignment.words.length !== alignment.word_end_times_milliseconds.length) throw new TypeError("Async returned mismatched word timestamp arrays");
  yield {
    correlation: "chunk",
    audio: decodeBase64(value.audio_base64),
    timestamps: alignment.words.map((word, index) => ({ kind: "word", value: word, startTimeMs: alignment.word_start_times_milliseconds[index]!, endTimeMs: alignment.word_end_times_milliseconds[index]! })),
  };
}

export async function listVoices(filters: VoiceFilters = {}, options: SynthesizeOptions = {}): Promise<VoiceList> { return (await checked(await requestVoiceList(filters, client(options)))).json() as Promise<VoiceList>; }
export async function getVoice(voiceId: string, options: SynthesizeOptions = {}): Promise<Voice> { return (await checked(await requestVoice(voiceId, client(options)))).json() as Promise<Voice>; }
export async function getVoices(voiceIds: readonly string[], options: SynthesizeOptions = {}): Promise<readonly Voice[]> { return (await checked(await requestVoices(voiceIds, client(options)))).json() as Promise<readonly Voice[]>; }
export async function updateVoice(voiceId: string, update: VoiceUpdate, options: SynthesizeOptions = {}): Promise<void> { await checked(await requestUpdateVoice(voiceId, update, client(options))); }
export async function deleteVoice(voiceId: string, options: SynthesizeOptions = {}): Promise<void> { await checked(await requestDeleteVoice(voiceId, client(options))); }
export async function getVoicePreview(voiceId: string, options: SynthesizeOptions = {}): Promise<string> { const value = await (await checked(await requestVoicePreview(voiceId, client(options)))).json() as { readonly signed_url: string }; return value.signed_url; }
export interface CreateVoiceRequest { readonly audio: Uint8Array; readonly mediaType: "audio/wav" | "audio/mpeg" | "audio/flac" | "audio/aiff"; readonly name: string; readonly description?: string; readonly accent?: string; readonly gender?: "Male" | "Female" | "Neutral" | "Unspecified"; readonly style?: string; readonly audioEnhancement?: boolean }
export async function createVoice(request: CreateVoiceRequest, options: SynthesizeOptions = {}): Promise<ClonedVoice> {
  const bytes = new ArrayBuffer(request.audio.byteLength); new Uint8Array(bytes).set(request.audio);
  const form = new FormData();
  form.set("audio", new Blob([bytes], { type: request.mediaType }), `voice.${request.mediaType.split("/")[1]}`);
  form.set("name", request.name);
  if (request.description !== undefined) form.set("description", request.description);
  if (request.accent !== undefined) form.set("accent", request.accent);
  if (request.gender !== undefined) form.set("gender", request.gender);
  if (request.style !== undefined) form.set("style", request.style);
  if (request.audioEnhancement !== undefined) form.set("enhance", String(request.audioEnhancement));
  return (await checked(await requestCloneVoice(form, client(options)))).json() as Promise<ClonedVoice>;
}
