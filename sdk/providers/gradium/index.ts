import type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/gradium/index.ts";
import {
  createSpeech,
  getVoice,
  listVoices,
  type ClientOptions,
  type OutputFormat,
} from "../../generated/clients/gradium.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/gradium/index.ts";
export type { Voice } from "../../generated/clients/gradium.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

type ClientMessage =
  | {
      readonly type: "setup";
      readonly model_name: TtsRequest["model"];
      readonly voice_id: string;
      readonly output_format: OutputFormat;
    }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "end_of_stream" };

type ServerMessage =
  | { readonly type: "ready"; readonly request_id: string }
  | { readonly type: "audio"; readonly audio: string }
  | {
      readonly type: "text";
      readonly text: string;
      readonly start_s: number;
      readonly stop_s: number;
    }
  | { readonly type: "end_of_stream" }
  | { readonly type: "error"; readonly message: string; readonly code: number };

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.gradium?.apiKey
    ?? environment().SPEECHSWITCH_GRADIUM_API_KEY
    ?? environment().GRADIUM_API_KEY;
  if (!value) throw new TypeError("Missing auth.gradium.apiKey configuration");
  return value;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  return {
    apiKey: apiKey(options),
    baseUrl: options.baseUrl ?? "https://api.gradium.ai",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function outputFormat(request: TtsRequest): OutputFormat {
  const output = request.output;
  if (output.format === "ogg_opus") return "opus";
  if (output.format === "mulaw" || output.format === "alaw") return `${output.format}_8000`;
  if (output.format === "pcm" && output.sampleRateHz !== undefined && output.sampleRateHz !== 48000) {
    switch (output.sampleRateHz) {
      case 8000: return "pcm_8000";
      case 16000: return "pcm_16000";
      case 22050: return "pcm_22050";
      case 24000: return "pcm_24000";
      case 44100: return "pcm_44100";
    }
  }
  return output.format;
}

function nativeSocket(url: URL, key: string): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (
    url: string,
    options: { readonly headers: Readonly<Record<string, string>> },
  ) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url.href, { headers: { "x-api-key": key } });
}

function encodeMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

function decodeMessage(data: unknown): ServerMessage {
  if (typeof data !== "string") throw new TypeError("Gradium returned a non-text WebSocket message");
  const value = JSON.parse(data) as Partial<ServerMessage>;
  if (value.type === "ready" && typeof value.request_id === "string") return value as ServerMessage;
  if (value.type === "audio" && typeof value.audio === "string") return value as ServerMessage;
  if (value.type === "text" && typeof value.text === "string"
    && typeof value.start_s === "number" && typeof value.stop_s === "number") {
    return value as ServerMessage;
  }
  if (value.type === "end_of_stream") return value as ServerMessage;
  if (value.type === "error" && typeof value.message === "string" && typeof value.code === "number") {
    return value as ServerMessage;
  }
  throw new TypeError(`Gradium returned unknown WebSocket event: ${String(value.type)}`);
}

async function* streaming(
  request: TtsRequest,
  text: AsyncIterable<string>,
  options: SynthesizeOptions,
  timestamps: boolean,
): AsyncIterableIterator<Uint8Array | SynthesisEnvelope<Timestamp<"segment">>> {
  const key = apiKey(options);
  const socket = options.webSocket ?? nativeSocket(
    new URL("/api/speech/tts", options.webSocketUrl ?? "wss://api.gradium.ai"),
    key,
  );
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket,
    encode: encodeMessage,
    decode: decodeMessage,
  });
  connection.send({
    type: "setup",
    model_name: request.model,
    voice_id: request.voice,
    output_format: outputFormat(request),
  });
  let sending: Promise<void> | undefined;
  try {
    for await (const message of connection.messages) {
      if (message.type === "ready") {
        if (sending) throw new TypeError("Gradium returned more than one ready event");
        sending = (async () => {
          for await (const value of text) connection.send({ type: "text", text: value });
          connection.send({ type: "end_of_stream" });
        })();
      } else if (message.type === "audio") {
        const audio = decodeBase64(message.audio);
        yield timestamps ? { correlation: "timeline", audio, timestamps: [] } : audio;
      } else if (message.type === "text") {
        if (timestamps) yield {
          correlation: "timeline",
          timestamps: [{
            kind: "segment",
            value: message.text,
            startTimeMs: message.start_s * 1000,
            endTimeMs: message.stop_s * 1000,
          }],
        };
      } else if (message.type === "error") {
        throw new TypeError(`Gradium WebSocket error ${message.code}: ${message.message}`);
      } else {
        if (!sending) throw new TypeError("Gradium ended synthesis before becoming ready");
        await sending;
        return;
      }
    }
    if (sending) await sending;
    throw new TypeError("Gradium WebSocket closed before end_of_stream");
  } finally {
    connection.close();
  }
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Gradium returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text !== "string") {
    for await (const value of streaming(request, request.text, options, false)) {
      if (value instanceof Uint8Array) yield value;
    }
    return;
  }
  const response = await createSpeech({
    text: request.text,
    voice_id: request.voice,
    model_name: request.model,
    output_format: outputFormat(request),
    only_audio: true,
  }, resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Gradium returned no audio stream");
  yield* response.body;
}

export async function* synthesizeWithTimestamps(
  request: TtsRequestWithTimestamps,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"segment">>> {
  const completeText = request.text;
  const text = typeof completeText === "string"
    ? (async function* () { yield completeText; })()
    : completeText;
  for await (const value of streaming(request, text, options, true)) {
    if (!(value instanceof Uint8Array)) yield value;
  }
}

export interface VoiceOptions extends SynthesizeOptions {
  readonly skip?: number;
  readonly limit?: number;
  readonly includeCatalog?: boolean;
}

export function voices(options: VoiceOptions = {}) {
  return listVoices({
    skip: options.skip,
    limit: options.limit,
    includeCatalog: options.includeCatalog ?? true,
  }, resolve(options));
}

export function voice(voiceId: string, options: SynthesizeOptions = {}) {
  return getVoice(voiceId, resolve(options));
}
