import type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/cartesia/index.ts";
import {
  cartesiaVersion,
  decodeMessage,
  defaultBaseUrl,
  defaultWebSocketUrl,
  encodeMessage,
  synthesizeBytes,
  synthesizeSse,
  type ClientMessage,
  type ClientOptions,
  type Emotion,
  type GenerationRequest,
  type Language,
  type Model,
  type OutputFormat,
  type ServerMessage,
} from "../../generated/clients/cartesia.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { serverSentEvents } from "../../runtime/sse.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/cartesia/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

function environment(): Record<string, string | undefined> { return typeof process === "undefined" ? {} : process.env; }
function credentials(options: SynthesizeOptions): { readonly apiKey?: string; readonly accessToken?: string } {
  return {
    apiKey: options.auth?.cartesia?.apiKey ?? environment().SPEECHSWITCH_CARTESIA_API_KEY ?? environment().CARTESIA_API_KEY,
    accessToken: options.auth?.cartesia?.accessToken ?? environment().SPEECHSWITCH_CARTESIA_ACCESS_TOKEN ?? environment().CARTESIA_ACCESS_TOKEN,
  };
}
function client(options: SynthesizeOptions): ClientOptions {
  const auth = credentials(options);
  const credential = auth.apiKey ?? auth.accessToken;
  if (!credential) throw new TypeError("Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration");
  return { credential, fetch: options.fetch ?? globalThis.fetch, baseUrl: options.baseUrl ?? defaultBaseUrl, signal: options.signal };
}

function output(request: TtsRequest | TtsRequestWithTimestamps): OutputFormat {
  const value = request.output;
  if (value.format === "mp3") return { container: "mp3", sample_rate: value.sampleRateHz, bit_rate: value.bitRateBps };
  if (value.format === "wav") return { container: "wav", encoding: "pcm_s16le", sample_rate: value.sampleRateHz };
  if (value.format === "mulaw") return { container: "raw", encoding: "pcm_mulaw", sample_rate: value.sampleRateHz };
  if (value.format === "alaw") return { container: "raw", encoding: "pcm_alaw", sample_rate: value.sampleRateHz };
  if (value.format === "pcm") return { container: "raw", encoding: value.sampleEncoding === "float_32" ? "pcm_f32le" : "pcm_s16le", sample_rate: value.sampleRateHz };
  throw new TypeError(`Unsupported Cartesia output format: ${(value as { readonly format: string }).format}`);
}
function normalization(value: TtsRequest["textNormalization"] | TtsRequestWithTimestamps["textNormalization"]): string | undefined {
  if (typeof value === "boolean") return value ? "auto" : "off";
  return value?.locale;
}
function dictionary(request: TtsRequest | TtsRequestWithTimestamps): string | undefined {
  const ids = request.dictionarySelection?.dictionaryIds;
  if (!ids?.length) return undefined;
  if (ids.length !== 1) throw new TypeError("Cartesia accepts exactly one pronunciation dictionary");
  return ids[0];
}
function input(request: TtsRequest | TtsRequestWithTimestamps, transcript: string): GenerationRequest {
  return {
    model_id: request.model as Model,
    transcript,
    voice: request.voice,
    output_format: output(request),
    language: request.language as Language | undefined,
    locale: request.locale,
    accent: request.accent,
    normalization: normalization(request.textNormalization),
    pronunciation_dict_id: dictionary(request),
    generation_config: request.volumeScale === undefined && request.speed === undefined && request.emotion === undefined
      ? undefined
      : { volume: request.volumeScale, speed: request.speed, emotion: request.emotion as Emotion | undefined },
  };
}

async function error(response: Response): Promise<TypeError> {
  const text = (await response.text()).trim();
  try {
    const value = JSON.parse(text) as { readonly error_code?: unknown; readonly title?: unknown; readonly message?: unknown; readonly request_id?: unknown };
    if (typeof value.title === "string" && typeof value.message === "string") {
      const code = typeof value.error_code === "string" ? ` (${value.error_code})` : "";
      const request = typeof value.request_id === "string" ? ` [request ${value.request_id}]` : "";
      return new TypeError(`Cartesia returned HTTP ${response.status}${code}: ${value.title}: ${value.message}${request}`);
    }
  } catch {}
  return new TypeError(`Cartesia returned HTTP ${response.status}${text ? `: ${text}` : ""}`);
}
async function checked(response: Response): Promise<Response> { if (!response.ok) throw await error(response); return response; }

function socketUrl(options: SynthesizeOptions): string {
  const token = credentials(options).accessToken;
  if (!token) throw new TypeError("Native Cartesia WebSockets require auth.cartesia.accessToken; inject an authenticated webSocket when using an API key");
  const url = new URL(options.webSocketUrl ?? defaultWebSocketUrl);
  url.searchParams.set("cartesia_version", cartesiaVersion);
  url.searchParams.set("access_token", token);
  return url.href;
}
function nativeSocket(url: string): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (url: string) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url);
}
function contextId(request: TtsRequest | TtsRequestWithTimestamps): string { return request.continuityId ?? crypto.randomUUID(); }
function streamInput(request: TtsRequest | TtsRequestWithTimestamps, transcript: string, id: string, continued: boolean): ClientMessage {
  return {
    ...input(request, transcript),
    context_id: id,
    continue: continued,
    max_buffer_delay_ms: request.streamingBuffer?.maxDelayMs ?? (request.segmentation === "immediate" ? 0 : undefined),
    add_timestamps: request.timestampGranularity === "word" || undefined,
    add_phoneme_timestamps: request.timestampGranularity === "phoneme" || undefined,
    use_normalized_timestamps: request.normalizedTimestamps,
  };
}

async function* webSocketMessages(
  request: TtsRequest | TtsRequestWithTimestamps,
  text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>,
  options: SynthesizeOptions,
): AsyncIterableIterator<ServerMessage> {
  const id = contextId(request);
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket: options.webSocket ?? nativeSocket(socketUrl(options)),
    encode: encodeMessage,
    decode: decodeMessage,
  });
  const sending = (async () => {
    for await (const value of text) {
      if (typeof value === "string") connection.send(streamInput(request, value, id, true));
      else if (value.command === "clear") connection.send({ context_id: id, cancel: true });
      else connection.send({ ...streamInput(request, "", id, true), flush: true });
    }
    connection.send(streamInput(request, "", id, false));
  })();
  let done = false;
  try {
    for await (const message of connection.messages) {
      if (message.context_id !== undefined && message.context_id !== id) throw new TypeError(`Cartesia returned output for unexpected context ${message.context_id}`);
      if (message.type === "error") throw new TypeError(`Cartesia streaming synthesis failed${message.error_code ? ` (${message.error_code})` : ""}: ${message.title}: ${message.message}${message.request_id ? ` [request ${message.request_id}]` : ""}`);
      if (message.type === "done") { done = true; break; }
      yield message;
    }
    await sending;
    if (!done) throw new TypeError("Cartesia WebSocket closed before the done event");
  } finally { connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text !== "string") {
    for await (const message of webSocketMessages(request, request.text, options)) if (message.type === "chunk") yield decodeBase64(message.data);
    return;
  }
  const response = await checked(await synthesizeBytes(input(request, request.text), client(options)));
  if (!response.body) throw new TypeError("Cartesia returned no audio stream");
  yield* response.body;
}

function timestamps(message: ServerMessage): readonly Timestamp<"word" | "phoneme">[] {
  const timing = message.type === "timestamps" ? message.word_timestamps : message.type === "phoneme_timestamps" ? message.phoneme_timestamps : undefined;
  if (!timing) return [];
  const values = message.type === "timestamps" ? timing.words : timing.phonemes;
  if (!values || !timing.start || !timing.end || values.length !== timing.start.length || values.length !== timing.end.length) throw new TypeError("Cartesia returned mismatched timestamp arrays");
  const kind = message.type === "timestamps" ? "word" : "phoneme";
  return values.map((value, index) => ({ kind, value, startTimeMs: timing.start![index]! * 1000, endTimeMs: timing.end![index]! * 1000 }));
}
function correlationId(message: ServerMessage): string | undefined {
  const flush = (message as ServerMessage & { readonly flush_id?: unknown }).flush_id;
  return typeof flush === "number" ? `${message.context_id ?? "context"}:${flush}` : message.context_id;
}
function envelope(message: ServerMessage): SynthesisEnvelope<Timestamp<"word" | "phoneme">> | undefined {
  if (message.type === "chunk") return { correlation: "timeline", correlationId: correlationId(message), audio: decodeBase64(message.data), timestamps: [] };
  if (message.type === "timestamps" || message.type === "phoneme_timestamps") return { correlation: "timeline", correlationId: correlationId(message), timestamps: timestamps(message) };
  return undefined;
}
function sseMessage(data: string): ServerMessage { return decodeMessage(data); }

export async function* synthesizeWithTimestamps(request: TtsRequestWithTimestamps, options: SynthesizeOptions = {}): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word" | "phoneme">>> {
  if (typeof request.text !== "string") {
    for await (const message of webSocketMessages(request, request.text, options)) {
      const value = envelope(message);
      if (value) yield value;
    }
    return;
  }
  const response = await checked(await synthesizeSse({
    ...input(request, request.text),
    add_timestamps: request.timestampGranularity === "word" || undefined,
    add_phoneme_timestamps: request.timestampGranularity === "phoneme" || undefined,
    use_normalized_timestamps: request.normalizedTimestamps,
    context_id: request.continuityId,
  }, client(options)));
  if (!response.body) throw new TypeError("Cartesia returned no event stream");
  let done = false;
  for await (const data of serverSentEvents(response.body)) {
    const message = sseMessage(data);
    if (message.type === "error") throw new TypeError(`Cartesia timestamped synthesis failed${message.error_code ? ` (${message.error_code})` : ""}: ${message.title}: ${message.message}${message.request_id ? ` [request ${message.request_id}]` : ""}`);
    if (message.type === "done") { done = true; break; }
    const value = envelope(message);
    if (value) yield value;
  }
  if (!done) throw new TypeError("Cartesia SSE closed before the done event");
}
