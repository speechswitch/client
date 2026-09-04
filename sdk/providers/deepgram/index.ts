import type { TtsRequest } from "../../../schemas/providers/deepgram/index.ts";
import {
  decodeMessage,
  encodeMessage,
  generateSpeech,
  isModel,
  type ClientMessage,
  type GenerateSpeechInput,
  type Model,
  type ServerMessage,
  type StreamingEncoding,
} from "../../generated/clients/deepgram.ts";
import type { Auth } from "../../auth.ts";
import type { ClearEvent } from "../../dispatch.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest } from "../../../schemas/providers/deepgram/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.deepgram?.apiKey
    ?? environment().SPEECHSWITCH_DEEPGRAM_API_KEY
    ?? environment().DEEPGRAM_API_KEY;
  if (!value) throw new TypeError("Missing auth.deepgram.apiKey configuration");
  return value;
}

function model(request: TtsRequest): Model {
  const value = `${request.model === "aura-2" ? "aura-2" : "aura"}-${request.voice}-${request.language}`;
  if (!isModel(value)) {
    throw new TypeError(`Deepgram does not provide model ${value}`);
  }
  return value;
}

function restInput(request: TtsRequest, text: string): GenerateSpeechInput {
  const { output } = request;
  if (output.format === "pcm") {
    return {
      text,
      model: model(request),
      encoding: "linear16",
      container: "none",
      sampleRate: output.sampleRateHz,
      speed: request.speed,
    };
  }
  if (output.format === "wav") {
    return {
      text,
      model: model(request),
      encoding: "linear16",
      container: "wav",
      sampleRate: output.sampleRateHz,
      speed: request.speed,
    };
  }
  if (output.format === "ogg_opus") {
    return {
      text,
      model: model(request),
      encoding: "opus",
      container: "ogg",
      sampleRate: output.sampleRateHz,
      speed: request.speed,
    };
  }
  return {
    text,
    model: model(request),
    encoding: output.format,
    sampleRate: "sampleRateHz" in output ? output.sampleRateHz : undefined,
    bitRate: output.bitRateBps,
    speed: request.speed,
  };
}

function streamingEncoding(format: "pcm" | "mulaw" | "alaw"): StreamingEncoding {
  return format === "pcm" ? "linear16" : format;
}

function streamingUrl(request: TtsRequest, options: SynthesizeOptions): URL {
  const url = new URL(options.webSocketUrl ?? "wss://api.deepgram.com/v1/speak");
  url.searchParams.set("model", model(request));
  url.searchParams.set("encoding", streamingEncoding(request.output.format as "pcm" | "mulaw" | "alaw"));
  if ("sampleRateHz" in request.output && request.output.sampleRateHz !== undefined) {
    url.searchParams.set("sample_rate", String(request.output.sampleRateHz));
  }
  if (request.speed !== undefined) url.searchParams.set("speed", String(request.speed));
  return url;
}

function nativeSocket(url: URL, key: string): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (
    url: string,
    options: { readonly headers: Readonly<Record<string, string>> },
  ) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url.href, { headers: { authorization: `Token ${key}` } });
}

async function* streaming(
  request: TtsRequest,
  text: AsyncIterable<string | { readonly command: "clear" }>,
  options: SynthesizeOptions,
): AsyncIterableIterator<Uint8Array | ClearEvent> {
  const key = apiKey(options);
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket: options.webSocket ?? nativeSocket(streamingUrl(request, options), key),
    encode: encodeMessage,
    decode: decodeMessage,
  });
  const sending = (async () => {
    for await (const value of text) {
      connection.send(typeof value === "string"
        ? { type: "Speak", text: value }
        : { type: "Clear" });
    }
    connection.send({ type: "Close" });
  })();
  try {
    for await (const message of connection.messages) {
      if (message instanceof Uint8Array) yield message;
      else if (message.type === "Cleared") yield { event: "clear" };
    }
    await sending;
  } finally {
    connection.close();
  }
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Deepgram returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array | ClearEvent> {
  if (typeof request.text !== "string") {
    yield* streaming(request, request.text, options);
    return;
  }
  const response = await generateSpeech(restInput(request, request.text), {
    apiKey: apiKey(options),
    baseUrl: options.baseUrl ?? "https://api.deepgram.com",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Deepgram returned no audio stream");
  yield* response.body;
}
