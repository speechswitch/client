import type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/inworld/index.ts";
import {
  createSpeech,
  decodeMessage,
  defaultBaseUrl,
  defaultWebSocketUrl,
  encodeMessage,
  parseSpeechResult,
  parseStreamingSpeechResult,
  streamSpeech,
  type AudioConfig,
  type ClientOptions,
  type ClientMessage,
  type CreateContext,
  type DeliveryMode,
  type HttpAudioEncoding,
  type NormalizationMode,
  type ServerMessage,
  type SpeechInput,
  type SpeechResult,
  type TimestampType,
  type WebSocketAudioEncoding,
} from "../../generated/clients/inworld.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { jsonLines } from "../../runtime/json-lines.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/inworld/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

type InworldTimestamp = Timestamp<"character" | "word" | "phoneme" | "viseme">;

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.inworld?.apiKey
    ?? environment().SPEECHSWITCH_INWORLD_API_KEY
    ?? environment().INWORLD_API_KEY;
  if (!value) throw new TypeError("Missing auth.inworld.apiKey configuration");
  return value;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  return {
    apiKey: apiKey(options),
    baseUrl: options.baseUrl ?? defaultBaseUrl,
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function audioEncoding(format: TtsRequest["output"]["format"]): HttpAudioEncoding {
  switch (format) {
    case "mp3": return "MP3";
    case "ogg_opus": return "OGG_OPUS";
    case "alaw": return "ALAW";
    case "mulaw": return "MULAW";
    case "flac": return "FLAC";
    case "pcm": return "PCM";
    case "wav": return "WAV";
  }
}

function audioConfig(request: TtsRequest): AudioConfig {
  return {
    audioEncoding: audioEncoding(request.output.format),
    bitRate: request.output.bitRateBps,
    sampleRateHertz: request.output.sampleRateHz,
    speakingRate: request.speed,
  };
}

function webSocketAudioConfig(request: TtsRequest): AudioConfig<WebSocketAudioEncoding> {
  const encoding = audioEncoding(request.output.format);
  if (encoding === "FLAC") {
    throw new TypeError(`Inworld WebSocket does not support ${request.output.format}`);
  }
  return { ...audioConfig(request), audioEncoding: encoding };
}

function deliveryMode(value: TtsRequest["deliveryVariation"]): DeliveryMode | undefined {
  return value === undefined ? undefined : value.toUpperCase() as DeliveryMode;
}

function normalization(value: boolean | undefined): NormalizationMode | undefined {
  return value === undefined ? undefined : value ? "ON" : "OFF";
}

function timestampType(request: TtsRequest): TimestampType {
  return request.timestampGranularity === "character" ? "CHARACTER" : "WORD";
}

function input(request: TtsRequest, text: string, timestamps: boolean): SpeechInput {
  return {
    text,
    voiceId: request.voice,
    audioConfig: audioConfig(request),
    modelId: request.model,
    language: request.language,
    deliveryMode: deliveryMode(request.deliveryVariation),
    instruction: request.deliveryInstructions,
    temperature: request.temperature,
    timestampType: timestamps ? timestampType(request) : undefined,
    applyTextNormalization: normalization(request.textNormalization),
    enhanceGeneration: request.audioEnhancement,
    synthesisContext: request.contextTexts === undefined
      ? undefined
      : { previousRequests: request.contextTexts.map((previous) => ({ text: previous })) },
  };
}

function createContext(request: TtsRequest, timestamps: boolean): CreateContext {
  return {
    voiceId: request.voice,
    modelId: request.model,
    audioConfig: webSocketAudioConfig(request),
    temperature: request.temperature,
    timestampType: timestamps ? timestampType(request) : undefined,
    maxBufferDelayMs: request.streamingBuffer?.maxDelayMs,
    bufferCharThreshold: request.streamingBuffer?.characterThreshold,
    applyTextNormalization: normalization(request.textNormalization),
    autoMode: request.streamingBuffer?.automatic,
    timestampTransportStrategy: timestamps ? "SYNC" : undefined,
    language: request.language,
    deliveryMode: deliveryMode(request.deliveryVariation),
  };
}

function nativeSocket(url: string, key: string): WebSocketLike {
  const Constructor = globalThis.WebSocket as unknown as new (
    url: string,
    options: { readonly headers: Readonly<Record<string, string>> },
  ) => WebSocketLike;
  if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
  return new Constructor(url, { headers: { authorization: `Basic ${key}` } });
}

function statusError(status: { readonly code?: number; readonly message?: string } | undefined): TypeError | undefined {
  return status?.code === undefined || status.code === 0
    ? undefined
    : new TypeError(`Inworld WebSocket error ${status.code}${status.message ? `: ${status.message}` : ""}`);
}

async function* websocket(
  request: TtsRequest,
  text: AsyncIterable<string | { readonly command: "flush" }>,
  options: SynthesizeOptions,
  timestamps: boolean,
): AsyncIterableIterator<SpeechResult> {
  const key = apiKey(options);
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({
    socket: options.webSocket ?? nativeSocket(options.webSocketUrl ?? defaultWebSocketUrl, key),
    encode: encodeMessage,
    decode: decodeMessage,
  });
  const sending = (async () => {
    connection.send({ create: createContext(request, timestamps) });
    for await (const value of text) {
      connection.send(typeof value === "string"
        ? { send_text: { text: value } }
        : { flush_context: {} });
    }
    connection.send({ close_context: {} });
  })();
  try {
    for await (const message of connection.messages) {
      const result = message.result;
      if ("audioChunk" in result) {
        const error = statusError(result.audioChunk.status);
        if (error) throw error;
        yield parseSpeechResult(result.audioChunk);
      } else {
        const error = statusError(result.status);
        if (error) throw error;
        if ("contextClosed" in result) {
          await sending;
          return;
        }
      }
    }
    await sending;
    throw new TypeError("Inworld WebSocket closed before contextClosed");
  } finally {
    connection.close();
  }
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Inworld returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function alignment(values: SpeechResult["timestampInfo"]): InworldTimestamp[] {
  const result: InworldTimestamp[] = [];
  const words = values?.wordAlignment;
  if (words) {
    if (!words.words || !words.wordStartTimeSeconds || !words.wordEndTimeSeconds
      || words.words.length !== words.wordStartTimeSeconds.length
      || words.words.length !== words.wordEndTimeSeconds.length) {
      throw new TypeError("Inworld returned incomplete word alignment");
    }
    for (const [index, value] of words.words.entries()) result.push({
      kind: "word",
      value,
      startTimeMs: words.wordStartTimeSeconds[index]! * 1000,
      endTimeMs: words.wordEndTimeSeconds[index]! * 1000,
    });
    for (const detail of words.phoneticDetails ?? []) {
      for (const phone of detail.phones) {
        const startTimeMs = phone.startTimeSeconds * 1000;
        const endTimeMs = startTimeMs + phone.durationSeconds * 1000;
        result.push({ kind: "phoneme", value: phone.phoneSymbol, startTimeMs, endTimeMs });
        if (phone.visemeSymbol !== undefined) {
          result.push({ kind: "viseme", value: phone.visemeSymbol, startTimeMs, endTimeMs });
        }
      }
    }
  }
  const characters = values?.characterAlignment;
  if (characters) {
    if (!characters.characters || !characters.characterStartTimeSeconds || !characters.characterEndTimeSeconds
      || characters.characters.length !== characters.characterStartTimeSeconds.length
      || characters.characters.length !== characters.characterEndTimeSeconds.length) {
      throw new TypeError("Inworld returned incomplete character alignment");
    }
    for (const [index, value] of characters.characters.entries()) result.push({
      kind: "character",
      value,
      startTimeMs: characters.characterStartTimeSeconds[index]! * 1000,
      endTimeMs: characters.characterEndTimeSeconds[index]! * 1000,
    });
  }
  return result;
}

async function* http(
  request: TtsRequest,
  text: string,
  options: SynthesizeOptions,
  timestamps: boolean,
): AsyncIterableIterator<SpeechResult> {
  const client = resolve(options);
  if (request.latencyOptimization === "none") {
    const response = await createSpeech(input(request, text, timestamps), client);
    if (!response.ok) throw await responseError(response);
    yield parseSpeechResult(await response.json());
    return;
  }
  const response = await streamSpeech({
    ...input(request, text, timestamps),
    timestampTransportStrategy: timestamps ? "SYNC" : undefined,
  }, client);
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Inworld returned no JSON event stream");
  for await (const value of jsonLines(response.body)) yield parseStreamingSpeechResult(value);
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const results = typeof request.text === "string"
    ? http(request, request.text, options, false)
    : websocket(request, request.text, options, false);
  for await (const value of results) {
    if (value.audioContent) yield decodeBase64(value.audioContent);
  }
}

export async function* synthesizeWithTimestamps(
  request: TtsRequestWithTimestamps,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<SynthesisEnvelope<InworldTimestamp>> {
  const results = typeof request.text === "string"
    ? http(request, request.text, options, true)
    : websocket(request, request.text, options, true);
  for await (const value of results) yield {
    correlation: "chunk",
    audio: decodeBase64(value.audioContent),
    timestamps: alignment(value.timestampInfo),
  };
}
