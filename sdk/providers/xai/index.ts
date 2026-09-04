import type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/xai/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/xai/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

export interface ClearEvent { readonly event: "clear" }

interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: Fetch;
  readonly signal?: AbortSignal | null;
}

interface CreateSpeechInput {
  readonly text: string;
  readonly voice_id?: string;
  readonly output_format?: {
    readonly codec: "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
    readonly sample_rate?: number;
    readonly bit_rate?: number;
  };
  readonly language: string;
  readonly optimize_streaming_latency?: "0" | "1" | "2";
  readonly text_normalization?: boolean;
  readonly with_timestamps?: boolean;
  readonly speed?: number;
  readonly replace?: Readonly<Record<string, string>>;
}

interface CharacterTimes {
  readonly graph_chars: readonly string[];
  readonly graph_times: readonly (readonly [number, number])[];
}

export interface Voice {
  readonly voice_id: string;
  readonly name: string;
  readonly language?: string | null;
}

type ClientMessage =
  | { readonly type: "text.delta"; readonly delta: string }
  | { readonly type: "text.done" }
  | { readonly type: "text.clear" }
  | { readonly type: "session.update"; readonly replace: Readonly<Record<string, string>> };

type ServerMessage =
  | { readonly type: "audio.delta"; readonly delta?: string; readonly audio_timestamps?: CharacterTimes }
  | { readonly type: "audio.done"; readonly trace_id?: string }
  | { readonly type: "error"; readonly message?: string }
  | { readonly type: "audio.clear" }
  | { readonly type: "session.updated" };

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  const apiKey = options.auth?.xai?.apiKey ?? environment().SPEECHSWITCH_XAI_API_KEY
    ?? environment().XAI_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.xai.apiKey configuration");
  return {
    apiKey,
    baseUrl: options.baseUrl ?? "https://api.x.ai",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function input(request: TtsRequest, text: string, timestamps: boolean): CreateSpeechInput {
  return {
    text,
    voice_id: request.voice,
    language: request.language,
    output_format: request.output && {
      codec: request.output.format,
      sample_rate: request.output.sampleRateHz,
      bit_rate: request.output.bitRateBps,
    },
    optimize_streaming_latency: request.latencyOptimization === undefined
      ? undefined
      : ({ none: "0", moderate: "1", aggressive: "2" } as const)[request.latencyOptimization],
    text_normalization: request.textNormalization,
    with_timestamps: timestamps || undefined,
    speed: request.speed,
    replace: request.replacements && Object.fromEntries(
      request.replacements.map(({ pattern, replacement }) => [pattern, replacement]),
    ),
  };
}

function request(path: string, options: ClientOptions, init: RequestInit = {}): Promise<Response> {
  return options.fetch(new URL(path, options.baseUrl), {
    ...init,
    headers: { authorization: `Bearer ${options.apiKey}`, ...init.headers },
    signal: options.signal,
  });
}

function createSpeech(value: CreateSpeechInput, options: ClientOptions): Promise<Response> {
  return request("/v1/tts", options, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

export async function listVoices(options: ClientOptions): Promise<readonly Voice[]> {
  const response = await request("/v1/tts/voices", options);
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { readonly voices: readonly Voice[] }).voices;
}

export async function getVoice(voiceId: string, options: ClientOptions): Promise<Voice> {
  const response = await request(`/v1/tts/voices/${encodeURIComponent(voiceId)}`, options);
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<Voice>;
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`xAI returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function timestampValues(values: {
  readonly graph_chars?: readonly string[];
  readonly graph_times?: readonly (readonly [number, number])[];
} | undefined): Timestamp<"character">[] {
  if (!values?.graph_chars || !values.graph_times) {
    if (!values) return [];
    throw new TypeError("xAI returned incomplete character timestamps");
  }
  if (values.graph_chars.length !== values.graph_times.length) {
    throw new TypeError("xAI returned mismatched character timestamp arrays");
  }
  const times = values.graph_times;
  return values.graph_chars.map((value, index) => {
    const time = times[index]!;
    return {
      kind: "character",
      value,
      startTimeMs: time[0] * 1000,
      endTimeMs: time[1] * 1000,
    };
  });
}

function webSocketUrl(request: TtsRequest, options: SynthesizeOptions, timestamps: boolean): URL {
  const url = new URL(options.webSocketUrl ?? "wss://api.x.ai/v1/tts");
  url.searchParams.set("language", request.language);
  if (request.voice) url.searchParams.set("voice", request.voice);
  if (request.output) {
    url.searchParams.set("codec", request.output.format);
    if (request.output.sampleRateHz) url.searchParams.set("sample_rate", String(request.output.sampleRateHz));
    if (request.output.bitRateBps) url.searchParams.set("bit_rate", String(request.output.bitRateBps));
  }
  if (request.speed !== undefined) url.searchParams.set("speed", String(request.speed));
  if (request.latencyOptimization !== undefined) {
    url.searchParams.set(
      "optimize_streaming_latency",
      String(({ none: 0, moderate: 1, aggressive: 2 } as const)[request.latencyOptimization]),
    );
  }
  if (request.textNormalization !== undefined) url.searchParams.set("text_normalization", String(request.textNormalization));
  if (timestamps) url.searchParams.set("with_timestamps", "true");
  return url;
}

function nativeSocket(url: URL, apiKey: string): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (
    url: string,
    options: { readonly headers: Readonly<Record<string, string>> },
  ) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url.href, { headers: { authorization: `Bearer ${apiKey}` } });
}

function encodeMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

function decodeMessage(data: unknown): ServerMessage {
  if (typeof data !== "string") throw new TypeError("xAI returned a non-text WebSocket message");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object") throw new TypeError("xAI returned an invalid WebSocket event");
  const type = (value as { readonly type?: unknown }).type;
  if (type !== "audio.delta" && type !== "audio.done" && type !== "audio.clear"
    && type !== "session.updated" && type !== "error") {
    throw new TypeError(`xAI returned unknown WebSocket event: ${String(type)}`);
  }
  return value as ServerMessage;
}

async function* streaming(
  request: TtsRequest,
  text: AsyncIterable<string | { readonly command: "clear" }>,
  options: SynthesizeOptions,
  timestamps: boolean,
): AsyncIterableIterator<{
  readonly correlation: "chunk";
  readonly audio: Uint8Array;
  readonly timestamps: readonly Timestamp<"character">[];
} | ClearEvent> {
  const client = resolve(options);
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket: options.webSocket ?? nativeSocket(webSocketUrl(request, options, timestamps), client.apiKey),
    encode: encodeMessage,
    decode: decodeMessage,
  });
  const sending = (async () => {
    if (request.replacements) {
      connection.send({
        type: "session.update",
        replace: Object.fromEntries(
          request.replacements.map(({ pattern, replacement }) => [pattern, replacement]),
        ),
      });
    }
    let hasText = false;
    for await (const value of text) {
      if (typeof value === "string") {
        connection.send({ type: "text.delta", delta: value });
        hasText = true;
      } else {
        connection.send({ type: "text.clear" });
        hasText = false;
      }
    }
    if (hasText) connection.send({ type: "text.done" });
  })();
  try {
    for await (const message of connection.messages) {
      if (message.type === "audio.delta") {
        if (typeof message.delta !== "string") throw new TypeError("xAI audio.delta event has no audio data");
        yield {
          correlation: "chunk",
          audio: decodeBase64(message.delta),
          timestamps: timestampValues(message.audio_timestamps),
        };
      } else if (message.type === "audio.clear") {
        yield { event: "clear" };
      } else if (message.type === "audio.done") {
        await sending;
        return;
      } else if (message.type === "error") {
        if (typeof message.message !== "string") throw new TypeError("xAI error event has no message");
        throw new TypeError(`xAI streaming synthesis failed: ${message.message}`);
      }
    }
    await sending;
    throw new TypeError("xAI WebSocket closed before audio.done");
  } finally {
    connection.close();
  }
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array | ClearEvent> {
  if (typeof request.text !== "string") {
    for await (const value of streaming(request, request.text, options, false)) {
      yield "event" in value ? value : value.audio;
    }
    return;
  }
  const response = await createSpeech(input(request, request.text, false), resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("xAI returned no audio stream");
  yield* response.body;
}

export async function* synthesizeWithTimestamps(
  request: TtsRequestWithTimestamps,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"character">> | ClearEvent> {
  if (typeof request.text !== "string") {
    yield* streaming(request, request.text, options, true);
    return;
  }
  const response = await createSpeech(input(request, request.text, true), resolve(options));
  if (!response.ok) throw await responseError(response);
  const value = await response.json() as { readonly audio: string; readonly audio_timestamps: CharacterTimes };
  yield {
    correlation: "chunk",
    audio: decodeBase64(value.audio),
    timestamps: timestampValues(value.audio_timestamps),
  };
}

export interface VoiceOptions extends SynthesizeOptions {}

export function voices(options: VoiceOptions = {}) {
  return listVoices(resolve(options));
}

export function voice(voiceId: string, options: VoiceOptions = {}) {
  return getVoice(voiceId, resolve(options));
}
