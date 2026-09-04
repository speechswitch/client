import type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/fish/index.ts";
import {
  createSpeech,
  streamSpeechWithTimestamps,
  type ClientOptions,
  type Model,
  type TtsInput,
} from "../../generated/clients/fish.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import { decodeMessagePack, encodeMessagePack } from "../../runtime/msgpack.ts";
import { serverSentEvents } from "../../runtime/sse.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/fish/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

type ClientMessage =
  | { readonly event: "start"; readonly request: TtsInput }
  | { readonly event: "text"; readonly text: string }
  | { readonly event: "flush" }
  | { readonly event: "stop" };

type ServerMessage =
  | { readonly event: "audio"; readonly audio: Uint8Array }
  | { readonly event: "finish"; readonly reason: "stop" | "error" };

interface TimestampEvent {
  readonly audio_base64: string;
  readonly chunk_seq: number;
  readonly chunk_audio_offset_sec: number;
  readonly alignment: null | {
    readonly segments: readonly { readonly text: string; readonly start: number; readonly end: number }[];
  };
}

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.fish?.apiKey
    ?? environment().SPEECHSWITCH_FISH_API_KEY
    ?? environment().FISH_AUDIO_API_KEY;
  if (!value) throw new TypeError("Missing auth.fish.apiKey configuration");
  return value;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  return {
    apiKey: apiKey(options),
    baseUrl: options.baseUrl ?? "https://api.fish.audio",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function input(request: TtsRequest, text: string): TtsInput {
  const output = request.output;
  return {
    text,
    reference_id: request.voice,
    prosody: request.speed !== undefined || request.volumeDb !== undefined
      || request.loudnessNormalization !== undefined ? {
        speed: request.speed,
        volume: request.volumeDb,
        normalize_loudness: request.loudnessNormalization,
      } : undefined,
    normalize: request.textNormalization,
    format: output.format === "ogg_opus" ? "opus" : output.format,
    sample_rate: output.sampleRateHz,
    mp3_bitrate: output.format === "mp3" ? output.bitRateBps / 1000 as 64 | 128 | 192 : undefined,
    opus_bitrate: output.format === "ogg_opus" ? output.bitRateBps : undefined,
    latency: request.latencyOptimization === undefined
      ? undefined
      : ({ none: "normal", moderate: "balanced", aggressive: "low" } as const)[request.latencyOptimization],
  };
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Fish Audio returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function nativeSocket(url: URL, key: string, model: Model): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (
    url: string,
    options: { readonly headers: Readonly<Record<string, string>> },
  ) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url.href, { headers: { authorization: `Bearer ${key}`, model } });
}

function decodeMessage(data: unknown): ServerMessage {
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
    throw new TypeError("Fish Audio returned a non-binary WebSocket message");
  }
  const value = decodeMessagePack(data) as Partial<ServerMessage>;
  if (value.event === "audio" && value.audio instanceof Uint8Array) return value as ServerMessage;
  if (value.event === "finish" && (value.reason === "stop" || value.reason === "error")) return value as ServerMessage;
  throw new TypeError(`Fish Audio returned unknown WebSocket event: ${String(value.event)}`);
}

async function* streaming(
  request: TtsRequest,
  text: AsyncIterable<string | { readonly command: "flush" }>,
  options: SynthesizeOptions,
): AsyncIterableIterator<Uint8Array> {
  const key = apiKey(options);
  const socket = options.webSocket ?? nativeSocket(
    new URL("/v1/tts/live", options.webSocketUrl ?? "wss://api.fish.audio"),
    key,
    request.model,
  );
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket,
    encode: encodeMessagePack,
    decode: decodeMessage,
  });
  connection.send({ event: "start", request: input(request, "") });
  const sending = (async () => {
    for await (const value of text) {
      connection.send(typeof value === "string"
        ? { event: "text", text: value }
        : { event: "flush" });
    }
    connection.send({ event: "stop" });
  })();
  try {
    for await (const message of connection.messages) {
      if (message.event === "audio") yield message.audio;
      else {
        await sending;
        if (message.reason === "error") throw new TypeError("Fish Audio streaming synthesis failed");
        return;
      }
    }
    await sending;
    throw new TypeError("Fish Audio WebSocket closed before finish");
  } finally {
    connection.close();
  }
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text !== "string") {
    yield* streaming(request, request.text, options);
    return;
  }
  const response = await createSpeech(input(request, request.text), request.model, resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Fish Audio returned no audio stream");
  yield* response.body;
}

export async function* synthesizeWithTimestamps(
  request: TtsRequestWithTimestamps,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word">>> {
  const response = await streamSpeechWithTimestamps(input(request, request.text), request.model, resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Fish Audio returned no timestamp stream");
  const alignments = new Map<number, { readonly offset: number; readonly segments: TimestampEvent["alignment"] }>();
  for await (const data of serverSentEvents(response.body)) {
    const event = JSON.parse(data) as TimestampEvent;
    if (event.alignment) alignments.set(event.chunk_seq, {
      offset: event.chunk_audio_offset_sec,
      segments: event.alignment,
    });
    yield {
      correlation: "timeline",
      audio: decodeBase64(event.audio_base64),
      timestamps: [],
    };
  }
  const timestamps = [...alignments.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, value]) => value.segments?.segments.map((segment): Timestamp<"word"> => ({
      kind: "word",
      value: segment.text,
      startTimeMs: (value.offset + segment.start) * 1000,
      endTimeMs: (value.offset + segment.end) * 1000,
    })) ?? []);
  if (timestamps.length) yield { correlation: "timeline", timestamps };
}
