import type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/rime/index.ts";
import {
  defaultHttpUrl,
  defaultWebSocketServer,
  legacyWebSocketPath,
  modernWebSocketPath,
  synthesizeHttp,
  type AudioFormat,
  type ClientMessage,
  type ServerMessage,
} from "../../generated/clients/rime.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/rime/index.ts";

export interface SynthesizeOptions { readonly auth?: Auth; readonly fetch?: Fetch; readonly webSocket?: WebSocketLike; readonly baseUrl?: string; readonly webSocketUrl?: string; readonly signal?: AbortSignal }
function environment(): Record<string, string | undefined> { return typeof process === "undefined" ? {} : process.env; }
function apiKey(options: SynthesizeOptions): string { const value = options.auth?.rime?.apiKey ?? environment().SPEECHSWITCH_RIME_API_KEY ?? environment().RIME_API_KEY; if (!value) throw new TypeError("Missing auth.rime.apiKey configuration"); return value; }
const modelId = { coda: "coda", "mist-v3": "mistv3", "mist-v2": "mistv2" } as const;
const segment = { immediate: "immediate", sentence: "bySentence", explicit: "never" } as const;
function audioFormat(format: TtsRequest["output"]["format"]): AudioFormat { if (format === "ogg_opus") return "ogg"; if (format === "webm_opus") return "webm"; return format; }
function accept(format: TtsRequest["output"]["format"]): string { return { mp3: "audio/mpeg", wav: "audio/wav", ogg_opus: "audio/ogg;codecs=opus", webm_opus: "audio/webm;codecs=opus", pcm: "audio/L16", mulaw: "audio/PCMU" }[format]; }

function httpInput(request: TtsRequest, text: string) {
  return {
    speaker: request.voice, text, modelId: modelId[request.model], lang: request.language,
    samplingRate: request.output.sampleRateHz,
    timeScaleFactor: request.model === "mist-v2" || request.speed === undefined ? undefined : 1 / request.speed,
    speedAlpha: request.model === "mist-v2" && request.speed !== undefined ? 1 / request.speed : undefined,
    pauseBetweenBrackets: request.inlinePauses,
    phonemizeBetweenBrackets: request.inlinePhonemes,
    inlineSpeedAlpha: request.inlineSpeedFactors?.join(","),
    noTextNormalization: request.model === "mist-v2" && request.textNormalization !== undefined ? !request.textNormalization : undefined,
  };
}

function websocketUrl(request: TtsRequest | TtsRequestWithTimestamps, options: SynthesizeOptions): string {
  const path = request.model === "mist-v2" ? legacyWebSocketPath : modernWebSocketPath;
  const url = new URL(`${options.webSocketUrl ?? defaultWebSocketServer}${path}`);
  url.searchParams.set("speaker", request.voice);
  url.searchParams.set("modelId", modelId[request.model]);
  url.searchParams.set("audioFormat", audioFormat(request.output.format));
  url.searchParams.set("samplingRate", String(request.output.sampleRateHz));
  if (request.language) url.searchParams.set("lang", request.language);
  if (request.segmentation) url.searchParams.set("segment", segment[request.segmentation]);
  if (request.inlinePauses !== undefined) url.searchParams.set("pauseBetweenBrackets", String(request.inlinePauses));
  if (request.inlinePhonemes !== undefined) url.searchParams.set("phonemizeBetweenBrackets", String(request.inlinePhonemes));
  if (request.inlineSpeedFactors) url.searchParams.set("inlineSpeedAlpha", request.inlineSpeedFactors.join(","));
  if (request.speed !== undefined) url.searchParams.set("speedAlpha", String(request.model === "mist-v2" ? 1 / request.speed : request.speed));
  if (request.model === "mist-v2" && request.textNormalization !== undefined) url.searchParams.set("noTextNormalization", String(!request.textNormalization));
  return url.href;
}

function socket(request: TtsRequest | TtsRequestWithTimestamps, options: SynthesizeOptions, key: string): WebSocketLike {
  if (options.webSocket) return options.webSocket;
  if ((globalThis as typeof globalThis & { readonly Bun?: unknown }).Bun === undefined) throw new TypeError("Rime streaming requires an injected authenticated WebSocket in this runtime");
  const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { readonly headers: Readonly<Record<string, string>> }) => WebSocketLike;
  return new Constructor(websocketUrl(request, options), { headers: { authorization: `Bearer ${key}` } });
}

function message(data: unknown): ServerMessage {
  if (typeof data !== "string") throw new TypeError("Rime returned a non-text WebSocket message");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Rime returned an invalid WebSocket message");
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "chunk" && typeof candidate.data === "string") return value as ServerMessage;
  if (candidate.type === "timestamps" && candidate.word_timestamps && typeof candidate.word_timestamps === "object") return value as ServerMessage;
  if (candidate.type === "done") return value as ServerMessage;
  if (candidate.type === "error" && typeof candidate.message === "string") return value as ServerMessage;
  throw new TypeError("Rime returned an unknown WebSocket message");
}

async function* events(request: TtsRequest | TtsRequestWithTimestamps, options: SynthesizeOptions): AsyncIterableIterator<ServerMessage> {
  if (typeof request.text === "string") throw new TypeError("Rime WebSocket input must be incremental");
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({ socket: socket(request, options, apiKey(options)), encode: JSON.stringify, decode: message });
  const sending = (async () => { for await (const value of request.text) connection.send(typeof value === "string" ? { text: value } : { operation: value.command }); connection.send({ operation: "eos" }); })();
  try {
    for await (const value of connection.messages) { if (value.type === "error") throw new TypeError(`Rime returned an error: ${value.message}`); yield value; if (value.type === "done") break; }
    await sending;
  } finally { connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text !== "string") { for await (const event of events(request, options)) if (event.type === "chunk") yield decodeBase64(event.data); return; }
  const response = await synthesizeHttp(httpInput(request, request.text), accept(request.output.format), { apiKey: apiKey(options), fetch: options.fetch ?? globalThis.fetch, baseUrl: options.baseUrl ?? defaultHttpUrl, signal: options.signal });
  if (!response.ok) throw new TypeError(`Rime returned HTTP ${response.status}: ${await response.text()}`);
  if (!response.body) throw new TypeError("Rime returned no audio stream");
  yield* response.body;
}

function timestamps(event: Extract<ServerMessage, { readonly type: "timestamps" }>): readonly Timestamp<"word">[] {
  const { words, start, end } = event.word_timestamps;
  if (words.length !== start.length || words.length !== end.length || start.some((value) => typeof value !== "number") || end.some((value) => typeof value !== "number")) throw new TypeError("Rime returned misaligned word timestamps");
  return words.map((value, index) => ({ kind: "word", value, startTimeMs: start[index]! * 1000, endTimeMs: end[index]! * 1000 }));
}

export async function* synthesizeWithTimestamps(request: TtsRequestWithTimestamps, options: SynthesizeOptions = {}): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word">>> {
  for await (const event of events(request, options)) {
    if (event.type === "chunk") yield { correlation: "timeline", audio: decodeBase64(event.data), timestamps: [] };
    else if (event.type === "timestamps") yield { correlation: "timeline", timestamps: timestamps(event) };
  }
}
