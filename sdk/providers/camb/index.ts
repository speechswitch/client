import type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/camb/index.ts";
import {
  createVoice as requestCreateVoice,
  decodeMessage,
  defaultBaseUrl,
  defaultWebSocketUrl,
  deleteVoice as requestDeleteVoice,
  encodeMessage,
  listVoices as requestVoices,
  synthesize as requestSpeech,
  type ClientMessage,
  type ClientOptions,
  type LiveOutputFormat,
  type OutputFormat,
  type ServerMessage,
  type SpeechModel,
  type StreamTtsInput,
  type Voice,
} from "../../generated/clients/camb.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/camb/index.ts";
export type { Voice } from "../../generated/clients/camb.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

function environment(): Record<string, string | undefined> { return typeof process === "undefined" ? {} : process.env; }
function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.camb?.apiKey ?? environment().SPEECHSWITCH_CAMB_API_KEY ?? environment().CAMB_API_KEY;
  if (!value) throw new TypeError("Missing auth.camb.apiKey configuration");
  return value;
}
function client(options: SynthesizeOptions): ClientOptions { return { apiKey: apiKey(options), fetch: options.fetch ?? globalThis.fetch, baseUrl: options.baseUrl ?? defaultBaseUrl, signal: options.signal }; }
function voiceId(value: string): number { const id = Number(value); if (!Number.isInteger(id) || id <= 0) throw new TypeError("CAMB.AI voice must be a positive integer identifier"); return id; }
const wireModel = { "mars8-flash": "mars-flash", "mars8-instruct": "mars-instruct", "mars8-pro": "mars-pro" } as const;
function outputFormat(request: TtsRequest): OutputFormat {
  const output = request.output;
  if (output.format === "aac") return "adts";
  if (output.format !== "pcm") return output.format;
  const encoding = output.sampleEncoding === "signed_integer_16" ? "pcm_s16" : output.sampleEncoding === "signed_integer_32" ? "pcm_s32" : "pcm_f32";
  return `${encoding}${output.byteOrder === "little_endian" ? "le" : "be"}` as OutputFormat;
}
function restInput(request: TtsRequest, text: string): StreamTtsInput {
  return {
    text,
    language: request.language,
    voice_id: voiceId(request.voice),
    speech_model: wireModel[request.model] as SpeechModel,
    enhance_named_entities_pronunciation: request.namedEntityPronunciationEnhancement,
    output_configuration: { format: outputFormat(request), sample_rate: request.output.sampleRateHz, apply_enhancement: request.audioEnhancement },
    voice_settings: { enhance_reference_audio_quality: request.referenceAudioEnhancement, maintain_source_accent: request.accentPreservation, speaking_rate: request.speed },
  };
}
function liveFormat(request: TtsRequest | TtsRequestWithTimestamps): LiveOutputFormat { if (request.output.format === "pcm") throw new TypeError("CAMB.AI live TTS does not support PCM output"); return request.output.format; }
async function checked(response: Response): Promise<Response> { if (response.ok) return response; const detail = (await response.text()).trim(); throw new TypeError(`CAMB.AI returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`); }

function socketUrl(options: SynthesizeOptions, key: string): URL { const url = new URL(options.webSocketUrl ?? defaultWebSocketUrl); url.searchParams.set("api_key", key); return url; }
function nativeSocket(url: URL): WebSocketLike { const Constructor = globalThis.WebSocket as unknown as new (url: string) => WebSocketLike; if (!Constructor) throw new TypeError("This runtime does not provide WebSocket"); return new Constructor(url.href); }
function sessionStart(request: TtsRequest | TtsRequestWithTimestamps, timestamps: boolean): ClientMessage {
  return {
    type: "session.start",
    voice_id: voiceId(request.voice),
    language: request.language,
    output_format: liveFormat(request),
    sample_rate: request.output.sampleRateHz,
    word_timestamps: timestamps || undefined,
    idle_timeout: request.streamingBuffer?.maxDelayMs === undefined ? undefined : request.streamingBuffer.maxDelayMs / 1000,
    enhance_named_entities_pronunciation: request.namedEntityPronunciationEnhancement,
    apply_enhancement: request.audioEnhancement,
    enhance_reference_audio_quality: request.referenceAudioEnhancement,
    maintain_source_accent: request.accentPreservation,
    speaking_rate: request.speed,
    inference_steps: request.inferenceSteps,
  };
}
async function* liveMessages(request: TtsRequest | TtsRequestWithTimestamps, text: AsyncIterable<string>, timestamps: boolean, options: SynthesizeOptions): AsyncIterableIterator<ServerMessage> {
  const key = apiKey(options);
  const connection = await connectWebSocket<ClientMessage, ServerMessage>({ socket: options.webSocket ?? nativeSocket(socketUrl(options, key)), encode: encodeMessage, decode: decodeMessage });
  const sending = (async () => {
    connection.send(sessionStart(request, timestamps));
    let index = 0;
    for await (const value of text) connection.send({ type: "text.chunk", text: value, index: index++ });
    connection.send({ type: "text.done" });
  })();
  try {
    for await (const message of connection.messages) {
      if (!(message instanceof Uint8Array) && message.type === "session.error") throw new TypeError(`CAMB.AI live synthesis failed: ${message.error}`);
      if (!(message instanceof Uint8Array) && message.type === "segment.skipped") throw new TypeError(`CAMB.AI skipped segment ${message.segment_id}: ${message.text}`);
      if (!(message instanceof Uint8Array) && message.type === "session.done") { await sending; return; }
      yield message;
    }
    await sending;
    throw new TypeError("CAMB.AI WebSocket closed before session.done");
  } finally { connection.close(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array> {
  if (typeof request.text === "string") {
    const response = await checked(await requestSpeech(restInput(request, request.text), client(options)));
    if (!response.body) throw new TypeError("CAMB.AI returned no audio stream");
    yield* response.body;
    return;
  }
  let activeSegment: number | undefined;
  for await (const message of liveMessages(request, request.text, false, options)) {
    if (message instanceof Uint8Array) {
      if (activeSegment === undefined) throw new TypeError("CAMB.AI returned audio outside a segment");
      yield message;
    } else if (message.type === "segment.start") {
      if (activeSegment !== undefined) throw new TypeError("CAMB.AI started overlapping segments");
      activeSegment = message.segment_id;
    } else if (message.type === "segment.done") {
      if (message.segment_id !== activeSegment) throw new TypeError("CAMB.AI completed an unexpected segment");
      activeSegment = undefined;
    }
  }
  if (activeSegment !== undefined) throw new TypeError("CAMB.AI ended with an incomplete segment");
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array { const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0)); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result; }
export async function* synthesizeWithTimestamps(request: TtsRequestWithTimestamps, options: SynthesizeOptions = {}): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word">>> {
  let segment: { readonly id: number; readonly timestamps: readonly Timestamp<"word">[]; readonly chunks: Uint8Array[] } | undefined;
  for await (const message of liveMessages(request, request.text, true, options)) {
    if (message instanceof Uint8Array) {
      if (!segment) throw new TypeError("CAMB.AI returned audio outside a segment");
      segment.chunks.push(message);
    } else if (message.type === "segment.start") {
      if (segment) throw new TypeError("CAMB.AI started overlapping segments");
      segment = { id: message.segment_id, chunks: [], timestamps: (message.word_timestamps ?? []).map(({ word, start, end }) => ({ kind: "word", value: word, startTimeMs: start * 1000, endTimeMs: end * 1000 })) };
    } else if (message.type === "segment.done") {
      if (!segment || segment.id !== message.segment_id) throw new TypeError("CAMB.AI completed an unexpected segment");
      yield { correlation: "chunk", audio: concatenate(segment.chunks), timestamps: segment.timestamps };
      segment = undefined;
    }
  }
  if (segment) throw new TypeError("CAMB.AI ended with an incomplete segment");
}

export async function listVoices(options: SynthesizeOptions = {}): Promise<readonly Voice[]> { return (await checked(await requestVoices(client(options)))).json() as Promise<readonly Voice[]>; }
export interface CreateVoiceRequest { readonly name: string; readonly gender: 0 | 1 | 2 | 9; readonly audio: Uint8Array; readonly mediaType: "audio/aac" | "audio/flac" | "audio/mpeg" | "audio/wav"; readonly description?: string; readonly age?: number; readonly audioEnhancement?: boolean; readonly language?: string }
export async function createVoice(request: CreateVoiceRequest, options: SynthesizeOptions = {}): Promise<number> {
  const bytes = new ArrayBuffer(request.audio.byteLength); new Uint8Array(bytes).set(request.audio);
  const form = new FormData(); form.set("voice_name", request.name); form.set("gender", String(request.gender)); form.set("file", new Blob([bytes], { type: request.mediaType }), `voice.${request.mediaType.split("/")[1]}`);
  if (request.description !== undefined) form.set("description", request.description); if (request.age !== undefined) form.set("age", String(request.age)); if (request.audioEnhancement !== undefined) form.set("enhance_audio", String(request.audioEnhancement)); if (request.language !== undefined) form.set("language", request.language);
  const value = await (await checked(await requestCreateVoice(form, client(options)))).json() as { readonly voice_id: number };
  return value.voice_id;
}
export async function deleteVoice(voice: string, options: SynthesizeOptions = {}): Promise<void> { await checked(await requestDeleteVoice(voiceId(voice), client(options))); }
