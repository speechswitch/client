import type { TtsRequest } from "../../../schemas/providers/deepdub/index.ts";
import type { Auth } from "../../auth.ts";
import { encodeBase64 } from "../../base64.ts";
import { validateRequest } from "../../generated/validators/deepdub.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/deepdub/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  /** Client generation identifier for tracing; defaults to a fresh UUID. */
  readonly requestId?: string;
}

export class DeepdubError extends Error {
  readonly statusCode: number;
  readonly generationId: string;
  constructor(statusCode: number, generationId: string, message: string) {
    super(`Deepdub returned HTTP ${statusCode}: ${message}`);
    this.name = "DeepdubError";
    this.statusCode = statusCode;
    this.generationId = generationId;
  }
}

// The OpenAPI operation structurally declares just four fields; optional
// controls and their invariants live in prose and the official SDK.
interface Generation {
  readonly generationId: string;
  readonly model: "dd-etts-1.1" | "dd-etts-2.5" | "dd-etts-3.2";
  readonly targetText: string;
  readonly locale: string;
  readonly voicePromptId: string | undefined;
  readonly voiceReference: string | undefined;
  readonly performanceReferencePromptId: string | undefined;
  readonly format: "mp3" | "opus" | "mulaw";
  readonly sampleRate: number;
  readonly targetDuration: number | undefined;
  readonly tempo: number | undefined;
  readonly variance: number | undefined;
  readonly temperature: number | undefined;
  readonly seed: number | undefined;
  readonly promptBoost: boolean | undefined;
  readonly superStretch: boolean | undefined;
  readonly realtime: boolean | undefined;
  readonly cleanAudio: boolean;
  readonly autoGain: boolean | undefined;
  readonly targetGender: "male" | "female" | undefined;
  readonly accentControl: { readonly accentBaseLocale: string; readonly accentLocale: string; readonly accentRatio: number } | undefined;
}

/** Verify framing before yielding bytes: the trial API has returned Vorbis for "opus". */
async function* opusAudio(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterableIterator<Uint8Array> {
  const prefix = new Uint8Array(290); // Maximum Ogg header + segment table + codec signature.
  const pending: Uint8Array[] = [];
  let filled = 0; let verified = false;
  for await (const chunk of body) {
    signal.throwIfAborted();
    if (verified) { yield chunk; continue; }
    pending.push(chunk);
    const part = chunk.subarray(0, prefix.length - filled); prefix.set(part, filled); filled += part.length;
    if (filled < 27) continue;
    if (prefix[0] !== 0x4f || prefix[1] !== 0x67 || prefix[2] !== 0x67 || prefix[3] !== 0x53 || prefix[4] !== 0 || prefix[26] === 0) throw new TypeError("Deepdub did not return an Ogg Opus stream");
    const start = 27 + prefix[26]!;
    if (filled < start + 8) continue;
    if (new TextDecoder().decode(prefix.subarray(start, start + 8)) !== "OpusHead") throw new TypeError("Deepdub returned a different Ogg codec (the trial API has returned Vorbis) for requested Opus audio");
    verified = true;
    for (const bytes of pending) { signal.throwIfAborted(); yield bytes; }
    pending.length = 0;
  }
  signal.throwIfAborted();
  if (!verified) throw new TypeError("Deepdub returned a truncated Ogg Opus header");
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array> {
  validateRequest(request);
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.deepdub?.apiKey ?? environment.SPEECHSWITCH_DEEPDUB_API_KEY ?? environment.DEEPDUB_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.deepdub.apiKey configuration");
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://restapi.deepdub.ai/api/v1";
  const generationId = options.requestId ?? crypto.randomUUID();
  const model = ({ "og-1.1": "dd-etts-1.1", "lightning-2.5": "dd-etts-2.5", "phantom-x-3.2": "dd-etts-3.2" } as const)[request.model];
  // Byte length, exclusive positivity, and integer-only constraints are not schema annotations.
  if (request.referenceAudio?.byteLength === 0) throw new TypeError("Deepdub referenceAudio must not be empty");
  if (request.targetDurationMs === 0) throw new TypeError("Deepdub targetDurationMs must be positive");
  if (request.randomSeed !== undefined && !Number.isSafeInteger(request.randomSeed)) throw new TypeError("Deepdub randomSeed must be a safe integer");
  const format = request.output.format === "ogg_opus" ? "opus" : request.output.format;
  const sampleRate = request.output.sampleRateHz ?? (format === "mulaw" ? 8000 : 48000);
  if (!Number.isSafeInteger(sampleRate)) throw new TypeError("Deepdub sampleRateHz must be a safe integer");
  const wire: Generation = {
    generationId, model, targetText: request.text, locale: request.language,
    voicePromptId: request.voice,
    voiceReference: request.referenceAudio === undefined ? undefined : encodeBase64(request.referenceAudio),
    performanceReferencePromptId: request.deliveryReference,
    format, sampleRate,
    targetDuration: request.targetDurationMs === undefined ? undefined : request.targetDurationMs / 1000,
    tempo: request.speed, variance: request.deliveryVariance, temperature: request.temperature, seed: request.randomSeed,
    promptBoost: request.voiceBoost, superStretch: request.durationStretching,
    realtime: request.processingPriority === undefined ? undefined : request.processingPriority === "realtime",
    cleanAudio: request.audioEnhancement ?? true, autoGain: request.automaticGainControl,
    targetGender: request.speakerGender,
    accentControl: request.accentBlend === undefined ? undefined : { accentBaseLocale: request.accentBlend.baseLocale, accentLocale: request.accentBlend.targetLocale, accentRatio: request.accentBlend.ratio },
  };
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/tts`;
  const response = await fetch(url, {
    method: "POST", headers: { "x-api-key": apiKey, "content-type": "application/json" }, body: JSON.stringify(wire), signal,
  });
  if (!response.ok) {
    const body = await response.text(); let message = body;
    try { const error: unknown = JSON.parse(body); if (error && typeof error === "object" && "message" in error && typeof error.message === "string") message = error.message; } catch {}
    throw new DeepdubError(response.status, response.headers.get("x-generation-id") ?? generationId, message || response.statusText);
  }
  if (!response.body) throw new TypeError("Deepdub returned no audio stream");
  if (format === "opus") yield* opusAudio(response.body, signal);
  else for await (const chunk of response.body) { signal.throwIfAborted(); yield chunk; }
  signal.throwIfAborted();
}
