import type {
  TtsInput,
  TtsRequest,
} from "../../../schemas/providers/xai/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import { requestDefaults, validateRequest } from "../../generated/validators/xai.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsInput, TtsRequest } from "../../../schemas/providers/xai/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

export interface ClearEvent { readonly event: "clear" }
export interface UpdatedEvent {
  readonly event: "updated";
  readonly replacements: readonly { readonly pattern: string; readonly replacement: string }[];
}
export interface DoneEvent { readonly event: "done"; readonly traceId?: string }
export type StreamEvent = ClearEvent | UpdatedEvent | DoneEvent;

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
  readonly optimize_streaming_latency?: 0 | 1 | 2;
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
  | { readonly type: "audio.delta"; readonly delta: string; readonly audio_timestamps?: CharacterTimes; readonly audio_duration?: number }
  | { readonly type: "audio.done"; readonly trace_id?: string }
  | { readonly type: "error"; readonly message?: string }
  | { readonly type: "audio.clear" }
  | { readonly type: "session.updated"; readonly replace: Readonly<Record<string, string>> };

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

function input(request: TtsRequest, text: string, timestamps: boolean, language: string): CreateSpeechInput {
  return {
    text,
    voice_id: request.voice,
    language,
    output_format: request.output && {
      codec: request.output.format,
      sample_rate: request.output.sampleRateHz,
      bit_rate: request.output.bitRateBps,
    },
    optimize_streaming_latency: request.latencyOptimization === undefined
      ? undefined
      : ({ none: 0, moderate: 1, aggressive: 2 } as const)[request.latencyOptimization],
    text_normalization: request.textNormalization,
    with_timestamps: timestamps || undefined,
    speed: request.speed,
    replace: request.replacements && replacementMap(request.replacements),
  };
}

function replacementMap(replacements: readonly { readonly pattern: string; readonly replacement: string }[]): Readonly<Record<string, string>> {
  // Phrase equivalence is a wire constraint not expressible in the authored types.
  const phrases = new Set<string>();
  for (const { pattern } of replacements) {
    const phrase = pattern.trim().replace(/\s+/gu, " ").toLowerCase();
    if (phrases.has(phrase)) throw new TypeError(`Duplicate xAI replacement phrase: ${pattern}`);
    phrases.add(phrase);
  }
  return Object.fromEntries(replacements.map(({ pattern, replacement }) => [pattern, replacement]));
}

function request(path: string, options: ClientOptions, init: RequestInit = {}): Promise<Response> {
  options.signal?.throwIfAborted();
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

function timestampValues(raw: unknown): Timestamp<"character">[] {
  if (raw === undefined) return [];
  if (!raw || typeof raw !== "object") throw new TypeError("Invalid xAI character timestamps");
  const values = raw as Record<string, unknown>;
  const chars = values.graph_chars;
  const times = values.graph_times;
  if (!Array.isArray(chars) || !Array.isArray(times) || chars.length !== times.length) throw new TypeError("xAI returned incomplete or mismatched character timestamps");
  return chars.map((value: unknown, index) => {
    const time = times[index]!;
    if (typeof value !== "string" || !Array.isArray(time) || time.length !== 2
      || typeof time[0] !== "number" || typeof time[1] !== "number"
      || !Number.isFinite(time[0]) || !Number.isFinite(time[1]) || time[0] < 0 || time[1] < time[0]) throw new TypeError("Invalid xAI character timestamp interval");
    return {
      kind: "character",
      value,
      startTimeMs: time[0] * 1000,
      endTimeMs: time[1] * 1000,
    };
  });
}

function webSocketUrl(request: TtsRequest, options: SynthesizeOptions, timestamps: boolean, language: string): URL {
  const url = new URL(options.webSocketUrl ?? "wss://api.x.ai/v1/tts");
  url.searchParams.set("language", language);
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
  if (typeof Bun === "undefined" && (typeof process === "undefined" || !process.versions?.node)) {
    throw new TypeError("xAI streaming requires a backend proxy in browsers; browser WebSockets cannot set Authorization headers. Supply an authenticated webSocket override");
  }
  // Node's bundled Undici and Bun accept headers; DOM constructor types omit
  // this server-runtime extension. Keep that difference at the provider boundary.
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
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("xAI returned an invalid WebSocket event");
  const event = value as Record<string, unknown>;
  const type = event.type;
  if (type !== "audio.delta" && type !== "audio.done" && type !== "audio.clear"
    && type !== "session.updated" && type !== "error") {
    throw new TypeError(`xAI returned unknown WebSocket event: ${String(type)}`);
  }
  if (type === "session.updated" && (!event.replace || typeof event.replace !== "object"
    || Array.isArray(event.replace) || Object.values(event.replace).some(value => typeof value !== "string"))) {
    throw new TypeError("xAI session.updated event has no valid replacement map");
  }
  if (type === "audio.delta" && typeof event.delta !== "string") throw new TypeError("xAI audio.delta event has no audio data");
  if (type === "audio.done" && event.trace_id !== undefined && typeof event.trace_id !== "string") throw new TypeError("Invalid xAI trace identifier");
  if (type === "audio.delta" && event.audio_duration !== undefined && (typeof event.audio_duration !== "number" || !Number.isFinite(event.audio_duration) || event.audio_duration < 0)) throw new TypeError("Invalid xAI audio duration");
  return value as ServerMessage;
}

async function* streaming(
  request: TtsRequest,
  text: AsyncIterable<TtsInput>,
  options: SynthesizeOptions,
  timestamps: boolean,
  validateInput: (value: unknown) => void,
  language: string,
): AsyncIterableIterator<{
  readonly correlation: "chunk";
  readonly audio: Uint8Array;
  readonly durationMs?: number;
  readonly timestamps: readonly Timestamp<"character">[];
} | StreamEvent> {
  const client = resolve(options);
  const initialReplacements = request.replacements && replacementMap(request.replacements);
  options.signal?.throwIfAborted();
  const connection = await connectWebSocket({
    socket: options.webSocket ?? nativeSocket(webSocketUrl(request, options, timestamps, language), client.apiKey),
    encode: encodeMessage,
    decode: decodeMessage,
    signal: options.signal,
  });
  let source: AsyncIterator<TtsInput>;
  try { source = text[Symbol.asyncIterator](); } catch (error) { connection.close(); throw error; }
  let inputDone = false;
  let stopped = false;
  let hasText = false;
  let flushing = false;
  let clearing = false;
  let updates = 0;
  const stopInput = () => {
    if (stopped || inputDone) return;
    stopped = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  options.signal?.addEventListener("abort", stopInput, { once: true });
  try {
    options.signal?.throwIfAborted();
    if (initialReplacements) {
      updates++;
      connection.send({ type: "session.update", replace: initialReplacements });
    }
    const nextInput = () => Promise.resolve().then(() => source.next()).then(
      value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }),
    );
    const nextOutput = () => connection.messages.next().then(
      value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }),
    );
    let pendingInput = nextInput();
    let pendingOutput = nextOutput();
    let held: IteratorResult<TtsInput> | undefined;
    let preferInput = true;
    for (;;) {
      options.signal?.throwIfAborted();
      if (inputDone && !hasText && !flushing && !clearing && updates === 0) return;
      const availableInput = held
        ? !flushing && !clearing ? Promise.resolve({ kind: "input" as const, value: held }) : undefined
        : inputDone ? undefined : pendingInput;
      const event = await Promise.race(!availableInput ? [pendingOutput]
        : preferInput ? [availableInput, pendingOutput] : [pendingOutput, availableInput]);
      preferInput = !preferInput;
      options.signal?.throwIfAborted();
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        const result = event.value;
        if (!result.done) validateInput(result.value);
        // Do not pipeline a new utterance before its predecessor finishes. Still
        // accept clear/update while flushing, so cancellation remains responsive.
        if (clearing || (flushing && (result.done || typeof result.value === "string" || result.value.command === "flush"))) {
          held = result;
          continue;
        }
        held = undefined;
        if (result.done) {
          inputDone = true;
          if (hasText) { hasText = false; flushing = true; connection.send({ type: "text.done" }); }
        } else {
          const value = result.value;
          if (typeof value === "string") {
            if (value.length) { connection.send({ type: "text.delta", delta: value }); hasText = true; }
          } else if (value.command === "update") {
            const replace = replacementMap(value.replacements);
            updates++;
            connection.send({ type: "session.update", replace });
          } else if (value.command === "clear") {
            clearing = true; hasText = false;
            connection.send({ type: "text.clear" });
          } else if (hasText) {
            hasText = false; flushing = true;
            connection.send({ type: "text.done" });
          }
          pendingInput = nextInput();
        }
        continue;
      }
      if (event.value.done) throw new TypeError("xAI WebSocket closed before pending synthesis or acknowledgements completed");
      const message = event.value.value;
      pendingOutput = nextOutput();
      if (message.type === "audio.delta") {
        if (clearing) continue;
        yield {
          correlation: "chunk",
          audio: decodeBase64(message.delta),
          timestamps: timestampValues(message.audio_timestamps),
          ...(message.audio_duration === undefined ? {} : { durationMs: message.audio_duration * 1000 }),
        };
      } else if (message.type === "audio.clear") {
        if (!clearing) throw new TypeError("Unexpected xAI audio.clear acknowledgement");
        clearing = false; flushing = false;
        yield { event: "clear" };
      } else if (message.type === "audio.done") {
        if (clearing) continue;
        if (!flushing) throw new TypeError("Unexpected xAI audio.done acknowledgement");
        flushing = false;
        yield { event: "done", ...(message.trace_id === undefined ? {} : { traceId: message.trace_id }) };
      } else if (message.type === "session.updated") {
        if (!updates) throw new TypeError("Unexpected xAI session.updated acknowledgement");
        updates--;
        yield { event: "updated", replacements: Object.entries(message.replace).map(([pattern, replacement]) => ({ pattern, replacement })) };
      } else if (message.type === "error") {
        if (typeof message.message !== "string") throw new TypeError("xAI error event has no message");
        throw new TypeError(`xAI streaming synthesis failed: ${message.message}`);
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", stopInput);
    stopInput();
    connection.close();
  }
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array | SynthesisEnvelope<Timestamp<"character">> | StreamEvent> {
  const validateInput = validateRequest(request);
  const language = request.language ?? requestDefaults.language;
  const timestamps = request.timestampGranularity === "character";
  if (typeof request.text !== "string") {
    for await (const value of streaming(request, request.text, options, timestamps, validateInput, language)) {
      yield "event" in value || timestamps ? value : value.audio;
    }
    return;
  }
  const response = await createSpeech(input(request, request.text, timestamps, language), resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!timestamps) {
    if (!response.body) throw new TypeError("xAI returned no audio stream");
    for await (const bytes of response.body) { options.signal?.throwIfAborted(); yield bytes; }
    options.signal?.throwIfAborted();
    return;
  }
  const raw: unknown = await response.json();
  options.signal?.throwIfAborted();
  if (!raw || typeof raw !== "object" || !("audio" in raw) || typeof raw.audio !== "string") throw new TypeError("Invalid xAI timestamped audio response");
  const value = raw as Record<string, unknown>;
  if (value.duration !== undefined && (typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration < 0)) throw new TypeError("Invalid xAI audio duration");
  yield {
    correlation: "chunk",
    audio: decodeBase64(raw.audio),
    timestamps: timestampValues(value.audio_timestamps),
    ...(value.duration === undefined ? {} : { durationMs: value.duration * 1000 }),
  };
}

export interface VoiceOptions extends SynthesizeOptions {}

export function voices(options: VoiceOptions = {}) {
  return listVoices(resolve(options));
}

export function voice(voiceId: string, options: VoiceOptions = {}) {
  return getVoice(voiceId, resolve(options));
}
