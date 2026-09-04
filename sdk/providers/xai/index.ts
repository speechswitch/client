import type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/xai/index.ts";
import {
  createSpeech,
  getVoice,
  listVoices,
  type CharacterTimes,
  type ClientOptions,
  type CreateSpeechInput,
} from "../../generated/clients/xai-tts.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/xai/index.ts";
export { getVoice, listVoices } from "../../generated/clients/xai-tts.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

export interface ClearEvent { readonly event: "clear" }

type ServerMessage =
  | { readonly type: "audio.delta"; readonly delta: string; readonly audio_timestamps?: CharacterTimes }
  | { readonly type: "audio.done"; readonly trace_id?: string }
  | { readonly type: "audio.clear" | "session.updated" }
  | { readonly type: "error"; readonly message: string };

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

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`xAI returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function timestampValues(values: CharacterTimes | undefined): Timestamp<"character">[] {
  if (!values || values.graph_chars.length !== values.graph_times.length) {
    if (!values) return [];
    throw new TypeError("xAI returned mismatched character timestamp arrays");
  }
  return values.graph_chars.map((value, index) => {
    const time = values.graph_times[index]!;
    return {
      kind: "character",
      value,
      startTimeMs: time.start * 1000,
      endTimeMs: time.end * 1000,
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

function decodeMessage(data: unknown): ServerMessage {
  if (typeof data !== "string") throw new TypeError("xAI returned a non-text WebSocket message");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") {
    throw new TypeError("xAI returned an invalid WebSocket event");
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
  const connection = await connectWebSocket<object, ServerMessage>({
    socket: options.webSocket ?? nativeSocket(webSocketUrl(request, options, timestamps), client.apiKey),
    encode: JSON.stringify,
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
