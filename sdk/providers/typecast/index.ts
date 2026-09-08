import type { ComposedRequest, PauseSegment, TtsRequest, TtsSegment, TypecastEnvelope } from "../../../schemas/providers/typecast/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64, encodeBase64 } from "../../base64.ts";
import type { DoneEvent } from "../../dispatch.ts";
import { validateRequest } from "../../generated/validators/typecast.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest, TtsSegment, TypecastEnvelope } from "../../../schemas/providers/typecast/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  /** Default: byte streaming, except composition, timestamps, volume scaling or 44.1 kHz WAV require ordinary synthesis. */
  readonly transport?: "stream" | "http";
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Maximum timestamp JSON response bytes; default 128 MiB. Raw audio remains unbuffered and uncapped. */
  readonly maxTimestampResponseBytes?: number;
}
type Output = Uint8Array | TypecastEnvelope | DoneEvent;
const languages = {
  ar: "ara", bg: "bul", cs: "ces", da: "dan", de: "deu", el: "ell", en: "eng", fi: "fin", fr: "fra", hr: "hrv", id: "ind", it: "ita", ja: "jpn", ko: "kor",
  ms: "msa", nl: "nld", pl: "pol", pt: "por", ro: "ron", ru: "rus", sk: "slk", es: "spa", sv: "swe", ta: "tam", tl: "tgl", uk: "ukr", zh: "zho",
  bn: "ben", hi: "hin", hu: "hun", nan: "nan", no: "nor", pa: "pan", th: "tha", tr: "tur", vi: "vie", yue: "yue",
} as const;

export class TypecastError extends Error {
  override readonly name = "TypecastError";
  readonly status: number;
  constructor(status: number) { super(`Typecast returned HTTP ${status}`); this.status = status; }
}

function wireSpeech(request: Exclude<TtsRequest, ComposedRequest> | Exclude<TtsSegment, PauseSegment>, format: "wav" | "mp3") {
  const language = request.language ?? "auto";
  return {
    voice_id: request.voice, text: request.text, model: request.model,
    ...(language === "auto" ? {} : { language: languages[language] }),
    ...(request.randomSeed === undefined ? {} : { seed: request.randomSeed }),
    prompt: request.emotion === "auto"
      ? { emotion_type: "smart", previous_text: request.contextBefore?.text ?? "", next_text: request.contextAfter?.text ?? "" }
      : { ...(request.model === "ssfm-v30" ? { emotion_type: "preset" } : {}), emotion_preset: request.emotion ?? "normal", emotion_intensity: request.emotionIntensity ?? 1 },
    output: {
      audio_format: format, audio_pitch: request.pitchSemitones ?? 0, audio_tempo: request.speed ?? 1,
      ...(request.volumeScale === undefined ? {} : { volume: Math.round(request.volumeScale * 100) }),
      ...(request.targetLoudnessLufs === undefined ? {} : { target_lufs: request.targetLoudnessLufs }),
    },
  };
}

function decodeTimestamps(value: unknown, format: "wav" | "mp3", words: boolean, characters: boolean): TypecastEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Typecast timestamp response");
  const object = value as Record<string, unknown>;
  if (object.audio_format !== format || typeof object.audio_duration !== "number" || !Number.isFinite(object.audio_duration * 1000) || object.audio_duration < 0) throw new TypeError("Invalid Typecast timestamp audio metadata");
  if (typeof object.audio !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(object.audio)) throw new TypeError("Invalid Typecast base64 audio");
  const audio = decodeBase64(object.audio);
  if (!audio.byteLength || encodeBase64(audio) !== object.audio) throw new TypeError("Invalid Typecast base64 audio");
  const timestamps: TypecastEnvelope["timestamps"][number][] = [];
  for (const [key, kind, required] of [["words", "word", words], ["characters", "character", characters]] as const) {
    const entries = object[key];
    if (entries === null && !required) continue;
    if (!Array.isArray(entries)) throw new TypeError(`Typecast omitted ${key} alignment`);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Invalid Typecast alignment segment");
      const { start, end, text } = entry as Record<string, unknown>;
      if (typeof text !== "string" || typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start * 1000) || !Number.isFinite(end * 1000) || start < 0 || end < start) throw new TypeError("Invalid Typecast alignment interval");
      if (required) timestamps.push({ kind, value: text, startTimeMs: start * 1000, endTimeMs: end * 1000 });
    }
  }
  return { correlation: "chunk", audio, durationMs: object.audio_duration * 1000, timestamps };
}

async function* bytes(body: ReadableStream<Uint8Array>, signal: AbortSignal, aborted: Promise<never>): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const item = await Promise.race([reader.read(), aborted]); signal.throwIfAborted();
      if (item.done) return;
      if (item.value.byteLength) yield item.value;
    }
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Output> {
  validateRequest(request);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.typecast?.apiKey ?? environment.SPEECHSWITCH_TYPECAST_API_KEY ?? environment.TYPECAST_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.typecast.apiKey configuration");
  const format = request.output?.format ?? "wav";
  const granularity = request.timestampGranularity;
  const words = granularity === "word" || Array.isArray(granularity) && granularity.includes("word");
  const characters = granularity === "character" || Array.isArray(granularity) && granularity.includes("character");
  const full = request.segments !== undefined || granularity !== undefined || request.volumeScale !== undefined || format === "wav" && request.output?.sampleRateHz === 44100;
  const transport = options.transport ?? (full ? "http" : "stream");
  if (full && transport === "stream") throw new TypeError("Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis");
  if (transport === "http" && request.output?.format === "wav" && request.output.sampleRateHz === 32000) throw new TypeError("Typecast ordinary WAV uses 44100 Hz, not 32000 Hz");
  let payload: object;
  let operation = words || characters ? "with-timestamps" : transport === "stream" ? "stream" : "";
  if (request.segments !== undefined) {
    let textLength = 0; let pauseMs = 0; let speech = false;
    // Cross-element totals and the existence of speech are not field annotations.
    for (const segment of request.segments) {
      if (segment.kind === "speech") { speech = true; textLength += Array.from(segment.text).length; }
      else pauseMs += segment.pauseMs;
    }
    if (!speech || textLength > 2000 || pauseMs > 60000) throw new TypeError("Typecast composition requires speech, at most 2000 total text code points and at most 60000 ms total pauses");
    payload = { segments: request.segments.map(segment => {
      if (segment.kind === "speech") return { type: "tts", ...wireSpeech(segment, format) };
      const seconds = segment.pauseMs / 1000;
      if (seconds === 0) throw new TypeError("Typecast pause cannot be represented as positive seconds");
      return { type: "pause", duration_seconds: seconds };
    }) };
    operation = "compose";
  } else payload = wireSpeech(request, format);
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Typecast timeoutMs must be an integer between 0 and 2147483647");
  const maxTimestampResponseBytes = options.maxTimestampResponseBytes ?? 128 * 1024 * 1024;
  if (!Number.isSafeInteger(maxTimestampResponseBytes) || maxTimestampResponseBytes <= 0) throw new TypeError("Typecast maxTimestampResponseBytes must be a positive safe integer");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("Typecast synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Typecast synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    const url = new URL(options.baseUrl ?? "https://api.typecast.ai");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/text-to-speech${operation ? `/${operation}` : ""}`;
    if (words !== characters) url.searchParams.set("granularity", words ? "word" : "char");
    else url.searchParams.delete("granularity");
    const timestamped = words || characters;
    const fetch = options.fetch ?? globalThis.fetch;
    const pending = fetch(url, { method: "POST", redirect: "error", signal,
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", Accept: timestamped ? "application/json" : format === "wav" ? "audio/wav" : "audio/mpeg" }, body: JSON.stringify(payload) });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new TypecastError(response.status); }
    if (!response.body) throw new TypeError("Typecast returned no audio body");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType && (timestamped ? contentType !== "application/json" : contentType !== (format === "wav" ? "audio/wav" : "audio/mpeg") && contentType !== "application/octet-stream")) {
      void response.body.cancel().catch(() => {}); throw new TypeError("Typecast returned an unexpected content type");
    }
    if (timestamped) {
      const decoder = new TextDecoder("utf-8", { fatal: true }); let json = ""; let size = 0;
      for await (const chunk of bytes(response.body, signal, aborted)) {
        size += chunk.byteLength;
        if (size > maxTimestampResponseBytes) throw new TypeError("Typecast timestamp response exceeds maxTimestampResponseBytes");
        json += decoder.decode(chunk, { stream: true });
      }
      json += decoder.decode(); signal.throwIfAborted();
      yield decodeTimestamps(JSON.parse(json), format, words, characters);
    } else {
      let received = false;
      for await (const chunk of bytes(response.body, signal, aborted)) { received = true; yield chunk; }
      if (!received) throw new TypeError("Typecast returned no audio");
    }
    signal.throwIfAborted(); yield { event: "done" };
  } finally { if (timer !== undefined) clearTimeout(timer); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
