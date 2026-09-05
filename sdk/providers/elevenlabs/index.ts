import type { TtsRequest } from "../../../schemas/providers/elevenlabs/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { ClearEvent } from "../../dispatch.ts";
import { validateRequest } from "../../generated/validators/elevenlabs.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { newlineDelimitedJson } from "../../runtime/ndjson.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest } from "../../../schemas/providers/elevenlabs/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  /** API origin, optionally with a proxy prefix. */
  readonly baseUrl?: string;
  /** Full WebSocket endpoint override. */
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** False requests zero retention; requires an eligible provider account. */
  readonly requestLogging?: boolean;
}

export class ElevenLabsError extends Error {
  readonly statusCode: number;
  readonly errorCode: string | undefined;
  readonly requestId: string | undefined;
  constructor(payload: unknown, statusCode: number, requestId?: string) {
    const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const detail = value.detail && typeof value.detail === "object" ? value.detail as Record<string, unknown> : value;
    const message = typeof detail.message === "string" ? detail.message : typeof value.detail === "string" ? value.detail : typeof payload === "string" ? payload : JSON.stringify(payload);
    super(`ElevenLabs ${statusCode}: ${message}`);
    this.name = "ElevenLabsError"; this.statusCode = statusCode; this.requestId = requestId;
    this.errorCode = typeof detail.status === "string" ? detail.status : typeof value.error === "string" ? value.error : undefined;
  }
}

// Handwritten: the public AsyncAPI query fields are untyped, and its multi-context
// response casing contradicts the examples. Keep both documented spellings explicit.
type Input = string | { readonly command: "clear" } | { readonly command: "flush" };
type Output = Uint8Array | SynthesisEnvelope<Timestamp<"character">> | ClearEvent;
interface VoiceSettings {
  readonly stability: number | undefined;
  readonly similarity_boost: number | undefined;
  readonly style: number | undefined;
  readonly use_speaker_boost: boolean | undefined;
  readonly speed: number | undefined;
}
interface Configuration {
  readonly validateInput: (item: unknown) => void;
  readonly model: string;
  readonly format: string;
  readonly normalization: "auto" | "on" | "off";
  readonly voiceSettings: VoiceSettings;
  readonly dictionaries: readonly { readonly pronunciation_dictionary_id: string; readonly version_id: string | undefined }[] | undefined;
  readonly signal: AbortSignal;
  readonly logging: boolean;
}
interface HttpInput {
  readonly text: string;
  readonly model_id: string;
  readonly language_code: string | undefined;
  readonly voice_settings: VoiceSettings;
  readonly pronunciation_dictionary_locators: Configuration["dictionaries"];
  readonly seed: number | undefined;
  readonly apply_text_normalization: Configuration["normalization"];
  readonly apply_language_text_normalization: boolean;
  readonly previous_text: string | undefined;
  readonly next_text: string | undefined;
  readonly previous_request_ids: readonly string[] | undefined;
  readonly next_request_ids: readonly string[] | undefined;
}
type ClientMessage =
  | { readonly text: string; readonly context_id: string; readonly flush?: boolean; readonly voice_settings?: VoiceSettings; readonly generation_config?: { readonly chunk_length_schedule: readonly number[] }; readonly pronunciation_dictionary_locators?: Configuration["dictionaries"]; readonly xi_api_key?: string }
  | { readonly context_id: string; readonly close_context: true }
  | { readonly close_socket: true }
  | { readonly voices: readonly string[]; readonly xi_api_key?: string; readonly voice_settings: { readonly stability: number | undefined }; readonly pronunciation_dictionary_locators: Configuration["dictionaries"] }
  | { readonly inputs: readonly { readonly text: string; readonly voice_id: string }[] }
  | { readonly flush: true }
  | { readonly keep_alive: true };
interface Packet { readonly contextId: string | undefined; readonly audio: string | undefined; readonly alignment: unknown; readonly final: boolean; readonly error: ElevenLabsError | undefined }

function configuration(request: TtsRequest, signal: AbortSignal, logging: boolean): Configuration {
  const validateInput = validateRequest(request);
  const model = ({ "flash-v2": "eleven_flash_v2", "flash-v2.5": "eleven_flash_v2_5", "multilingual-v2": "eleven_multilingual_v2", "eleven-v3": "eleven_v3" } as const)[request.model];
  if (request.randomSeed !== undefined && !Number.isInteger(request.randomSeed)) throw new TypeError("ElevenLabs randomSeed must be an integer");
  const output = request.output;
  const rate = output.sampleRateHz ?? (output.format === "ogg_opus" ? 48000 : output.format === "mulaw" || output.format === "alaw" ? 8000 : output.format === "mp3" ? 44100 : undefined);
  const bits = output.bitRateBps ?? 128000;
  for (const context of [request.contextBefore, request.contextAfter]) {
    if (context?.requestIds && (!context.requestIds.length || context.requestIds.length > 3)) throw new TypeError("ElevenLabs context requires 1–3 request IDs");
  }
  if (request.pronunciationDictionaries && request.pronunciationDictionaries.length > 3) throw new TypeError("ElevenLabs supports up to three pronunciation dictionaries");
  const thresholds = request.textBufferThresholds;
  if (thresholds && (!thresholds.length || thresholds.some(value => !Number.isInteger(value) || value < 50 || value > 500))) throw new TypeError("ElevenLabs buffering thresholds require integer character counts from 50 to 500");
  return {
    validateInput, model, format: `${output.format === "ogg_opus" ? "opus" : output.format === "mulaw" ? "ulaw" : output.format}_${rate}${output.format === "mp3" || output.format === "ogg_opus" ? `_${bits / 1000}` : ""}`,
    normalization: request.latencyOptimization === "maximum" || request.textNormalization === false ? "off" : request.textNormalization === true ? "on" : "auto",
    voiceSettings: { stability: request.stability, similarity_boost: request.voiceSimilarity, style: request.styleExaggeration, use_speaker_boost: request.voiceBoost, speed: request.speed },
    dictionaries: request.pronunciationDictionaries?.map(value => ({ pronunciation_dictionary_id: value.id, version_id: value.versionId })), signal, logging,
  };
}

function timestamps(raw: unknown, protocol: "http" | "tts" | "dialogue"): readonly Timestamp<"character">[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Invalid ElevenLabs alignment");
  const value = raw as Record<string, unknown>;
  const chars = value[protocol === "http" ? "characters" : "chars"];
  const starts = value[protocol === "http" ? "character_start_times_seconds" : protocol === "tts" ? "charStartTimesMs" : "char_start_times_ms"];
  const durations = value[protocol === "http" ? "character_end_times_seconds" : protocol === "tts" ? "charDurationsMs" : "char_durations_ms"];
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(durations) || chars.length !== starts.length || chars.length !== durations.length) throw new TypeError("ElevenLabs returned incomplete or mismatched alignment arrays");
  return chars.map((character: unknown, index) => {
    const start: unknown = starts[index]; const duration: unknown = durations[index];
    if (typeof character !== "string" || typeof start !== "number" || typeof duration !== "number" || !Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration < (protocol === "http" ? start : 0)) throw new TypeError("ElevenLabs returned invalid character timing");
    return { kind: "character", value: character, startTimeMs: protocol === "http" ? start * 1000 : start, endTimeMs: protocol === "http" ? duration * 1000 : start + duration };
  });
}

async function* http(request: TtsRequest, text: string, config: Configuration, apiKey: string, baseUrl: string, fetch: Fetch): AsyncIterableIterator<Output> {
  const timed = request.timestampGranularity !== undefined;
  const wav = request.output.format === "wav";
  const suffix = `${wav ? "" : "/stream"}${timed ? "/with-timestamps" : ""}`;
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/text-to-speech/${encodeURIComponent(request.voice)}${suffix}`;
  url.searchParams.set("output_format", config.format); url.searchParams.set("enable_logging", String(config.logging));
  if (request.latencyOptimization !== undefined) url.searchParams.set("optimize_streaming_latency", String(({ none: 0, moderate: 1, strong: 2, aggressive: 3, maximum: 4 } as const)[request.latencyOptimization]));
  const input: HttpInput = {
    text, model_id: config.model, language_code: request.language, voice_settings: config.voiceSettings,
    pronunciation_dictionary_locators: config.dictionaries, seed: request.randomSeed,
    apply_text_normalization: config.normalization, apply_language_text_normalization: request.languageTextNormalization ?? false,
    previous_text: request.contextBefore?.text, next_text: request.contextAfter?.text,
    previous_request_ids: request.contextBefore?.requestIds, next_request_ids: request.contextAfter?.requestIds,
  };
  const response = await fetch(url, { method: "POST", headers: { "xi-api-key": apiKey, "content-type": "application/json" }, body: JSON.stringify(input), signal: config.signal });
  if (!response.ok) {
    const body = await response.text(); let error: unknown = body;
    try { error = JSON.parse(body); } catch {}
    throw new ElevenLabsError(error, response.status, response.headers.get("request-id") ?? undefined);
  }
  if (!response.body) throw new TypeError("ElevenLabs returned no audio stream");
  if (!timed) {
    for await (const bytes of response.body) { config.signal.throwIfAborted(); yield bytes; }
  } else {
    // WAV timestamps use the ordinary JSON endpoint; other formats use NDJSON.
    const packets = wav ? [await response.json()] : newlineDelimitedJson(response.body);
    for await (const raw of packets) {
      config.signal.throwIfAborted();
      if (!raw || typeof raw !== "object" || !("audio_base64" in raw) || typeof raw.audio_base64 !== "string") throw new TypeError("Invalid ElevenLabs timestamped audio chunk");
      const value = raw as Record<string, unknown>;
      yield { correlation: "chunk", audio: decodeBase64(raw.audio_base64), timestamps: timestamps(value[request.timestampText === "normalized" ? "normalized_alignment" : "alignment"], "http") };
    }
  }
  config.signal.throwIfAborted();
}

function decodeMessage(data: unknown, dialogue: boolean, normalized: boolean): Packet {
  if (typeof data !== "string") throw new TypeError("ElevenLabs returned a non-text WebSocket frame");
  const raw: unknown = JSON.parse(data);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Invalid ElevenLabs WebSocket frame");
  const value = raw as Record<string, unknown>;
  if (value.context_id !== undefined && value.contextId !== undefined && value.context_id !== value.contextId) throw new TypeError("Conflicting ElevenLabs context identifiers");
  const contextId = value.context_id ?? value.contextId;
  if (contextId !== undefined && typeof contextId !== "string") throw new TypeError("Invalid ElevenLabs context identifier");
  if (value.error !== undefined || value.detail !== undefined) return { contextId, audio: undefined, alignment: undefined, final: false, error: new ElevenLabsError(value, typeof value.code === "number" ? value.code : 0) };
  if (value.is_final !== undefined && value.isFinal !== undefined && value.is_final !== value.isFinal) throw new TypeError("Conflicting ElevenLabs final flags");
  const final = value.is_final ?? value.isFinal;
  if (final !== undefined && typeof final !== "boolean") throw new TypeError("Invalid ElevenLabs final flag");
  if (value.audio !== undefined && value.audio !== null && typeof value.audio !== "string") throw new TypeError("Invalid ElevenLabs audio payload");
  const audio = typeof value.audio === "string" ? value.audio : undefined;
  if (dialogue && value.is_final_audio_for_turn !== undefined && typeof value.is_final_audio_for_turn !== "boolean") throw new TypeError("Invalid ElevenLabs turn-final flag");
  const turnFinal = dialogue && value.is_final_audio_for_turn === true;
  if (audio === undefined && final !== true && !turnFinal) throw new TypeError("Unknown ElevenLabs WebSocket message");
  if (!dialogue && typeof contextId !== "string") throw new TypeError("ElevenLabs multi-context output lacks its context identifier");
  return { contextId, audio, final: final === true, error: undefined, alignment: value[normalized ? dialogue ? "normalized_alignment" : "normalizedAlignment" : "alignment"] };
}

async function* websocket(request: TtsRequest, text: AsyncIterable<Input>, config: Configuration, socket: WebSocketLike, apiKey: string | undefined): AsyncIterableIterator<Output> {
  const dialogue = request.model === "eleven-v3";
  const connection = await connectWebSocket({ socket, signal: config.signal, encode: (message: ClientMessage) => JSON.stringify(message), decode: data => decodeMessage(data, dialogue, request.timestampText === "normalized") });
  let source: AsyncIterator<Input>;
  try { source = text[Symbol.asyncIterator](); } catch (error) { connection.close(); throw error; }
  let stopped = false; let inputDone = false; let used = false;
  let contextId: string = crypto.randomUUID();
  const retired = new Set<string>();
  const stopInput = () => {
    if (stopped || inputDone) return; stopped = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  config.signal.addEventListener("abort", stopInput, { once: true });
  let timer: ReturnType<typeof setInterval> | undefined;
  const initialize = () => {
    if (dialogue) connection.send({ voices: [request.voice], xi_api_key: apiKey, voice_settings: { stability: request.stability }, pronunciation_dictionary_locators: config.dictionaries });
    else connection.send({ text: " ", context_id: contextId, xi_api_key: apiKey, voice_settings: config.voiceSettings, pronunciation_dictionary_locators: config.dictionaries, generation_config: request.textBuffering === false ? undefined : { chunk_length_schedule: request.textBufferThresholds ?? [120, 160, 250, 290] } });
  };
  try {
    config.signal.throwIfAborted(); initialize();
    const nextInput = () => Promise.resolve().then(() => { config.signal.throwIfAborted(); return source.next(); }).then(value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }));
    const nextOutput = () => connection.messages.next().then(value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }));
    let failHeartbeat!: (event: { readonly kind: "error"; readonly error: unknown }) => void;
    const heartbeatFailure = new Promise<{ readonly kind: "error"; readonly error: unknown }>(resolve => { failHeartbeat = resolve; });
    timer = setInterval(() => {
      if (inputDone) return;
      try { connection.send(dialogue ? { keep_alive: true } : { context_id: contextId, text: "" }); }
      catch (error) { failHeartbeat({ kind: "error", error }); }
    }, 10000);
    let pendingInput = nextInput(); let pendingOutput = nextOutput(); let preferInput = true;
    for (;;) {
      const event = await Promise.race(inputDone ? [pendingOutput, heartbeatFailure] : preferInput ? [pendingInput, pendingOutput, heartbeatFailure] : [pendingOutput, pendingInput, heartbeatFailure]);
      config.signal.throwIfAborted(); preferInput = !preferInput;
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        if (event.value.done) {
          inputDone = true;
          if (!used) return;
          if (!dialogue) connection.send({ context_id: contextId, text: " ", flush: true });
          connection.send({ close_socket: true });
        } else {
          const value = event.value.value;
          config.validateInput(value);
          if (typeof value === "string") {
            if (value.length) { connection.send(dialogue ? { inputs: [{ text: value, voice_id: request.voice }] } : { context_id: contextId, text: value }); used = true; }
          } else if (value.command === "flush") {
            if (used) connection.send(dialogue ? { flush: true } : { context_id: contextId, text: " ", flush: true });
          } else if (value.command === "clear") {
            connection.send({ context_id: contextId, close_context: true });
            retired.add(contextId); contextId = crypto.randomUUID(); used = false; initialize();
            // Local playback boundary; closing a context has no dedicated clear ACK.
            yield { event: "clear" };
          }
          pendingInput = nextInput();
        }
      } else {
        if (event.value.done) throw new TypeError("ElevenLabs WebSocket closed before final output");
        const packet = event.value.value;
        if (packet.contextId !== undefined && retired.has(packet.contextId)) { pendingOutput = nextOutput(); continue; }
        if (packet.error) throw packet.error;
        if (!dialogue && packet.contextId !== contextId) throw new TypeError("ElevenLabs returned an unexpected context identifier");
        if (packet.audio !== undefined) {
          const audio = decodeBase64(packet.audio);
          if (request.timestampGranularity === undefined) yield audio;
          else yield { correlation: "chunk", audio, timestamps: timestamps(packet.alignment, dialogue ? "dialogue" : "tts") };
        }
        if (packet.final) {
          if (inputDone) return;
          if (dialogue) throw new TypeError("ElevenLabs dialogue ended before input completed");
          retired.add(contextId); contextId = crypto.randomUUID(); used = false; initialize();
        }
        pendingOutput = nextOutput();
      }
    }
  } finally {
    if (timer !== undefined) clearInterval(timer);
    config.signal.removeEventListener("abort", stopInput); stopInput(); connection.close();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 2147483647)) throw new TypeError("ElevenLabs timeoutMs must be an integer between 1 and 2147483647");
  const external = options.signal ?? new AbortController().signal;
  const signal = options.timeoutMs === undefined ? external : AbortSignal.any([external, AbortSignal.timeout(options.timeoutMs)]);
  signal.throwIfAborted();
  const environment = typeof process === "undefined" ? {} : process.env;
  const entry = options.auth?.elevenlabs;
  const apiKey = entry?.apiKey ?? environment.SPEECHSWITCH_ELEVENLABS_API_KEY ?? environment.ELEVENLABS_API_KEY;
  const config = configuration(request, signal, options.requestLogging ?? true);
  const baseUrl = options.baseUrl ?? "https://api.elevenlabs.io";
  if (typeof request.text === "string") {
    if (!apiKey) throw new TypeError("Missing auth.elevenlabs.apiKey configuration");
    yield* http(request, request.text, config, apiKey, baseUrl, options.fetch ?? globalThis.fetch);
  } else {
    if (!entry?.singleUseToken && !apiKey) throw new TypeError("Missing auth.elevenlabs.apiKey or singleUseToken configuration");
    const endpoint = request.model === "eleven-v3" ? "v1/text-to-dialogue/stream-input" : `v1/text-to-speech/${encodeURIComponent(request.voice)}/multi-stream-input`;
    const url = new URL(options.webSocketUrl ?? baseUrl);
    if (options.webSocketUrl === undefined) url.pathname = `${url.pathname.replace(/\/$/, "")}/${endpoint}`;
    if (url.protocol === "https:") url.protocol = "wss:"; else if (url.protocol === "http:") url.protocol = "ws:";
    url.searchParams.set("model_id", config.model); url.searchParams.set("output_format", config.format);
    url.searchParams.set("sync_alignment", String(request.timestampGranularity !== undefined)); url.searchParams.set("enable_logging", String(config.logging));
    url.searchParams.set("apply_text_normalization", config.normalization);
    if (request.language !== undefined) url.searchParams.set("language_code", request.language);
    if (request.randomSeed !== undefined) url.searchParams.set("seed", String(request.randomSeed));
    if (entry?.singleUseToken) url.searchParams.set("single_use_token", entry.singleUseToken);
    if (request.model !== "eleven-v3") {
      url.searchParams.set("inactivity_timeout", "20"); url.searchParams.set("auto_mode", String(request.textBuffering === false)); url.searchParams.set("enable_ssml_parsing", String(request.inputType === "ssml"));
    }
    yield* websocket(request, request.text, config, options.webSocket ?? new WebSocket(url), entry?.singleUseToken ? undefined : apiKey);
  }
}
