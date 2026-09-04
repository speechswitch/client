import type { TtsRequest } from "../../../schemas/providers/deepdub/index.ts";
import { defaultBaseUrl, synthesize as requestSpeech, type ClientOptions, type GenerationRequest, type Model } from "../../generated/clients/deepdub.ts";
import type { Auth } from "../../auth.ts";
import { encodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/deepdub/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
}

function environment(): Record<string, string | undefined> { return typeof process === "undefined" ? {} : process.env; }
function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.deepdub?.apiKey ?? environment().SPEECHSWITCH_DEEPDUB_API_KEY ?? environment().DEEPDUB_API_KEY;
  if (!value) throw new TypeError("Missing auth.deepdub.apiKey configuration");
  return value;
}
function client(options: SynthesizeOptions): ClientOptions { return { apiKey: apiKey(options), fetch: options.fetch ?? globalThis.fetch, baseUrl: options.baseUrl ?? defaultBaseUrl, signal: options.signal }; }
const models = { "lightning-2.5": "dd-etts-2.5", "og-1.1": "dd-etts-1.1", "phantom-x-3.2": "dd-etts-3.2" } as const;
function input(request: TtsRequest): GenerationRequest {
  return {
    model: models[request.model] as Model,
    targetText: request.text,
    locale: request.language,
    voicePromptId: request.voice,
    voiceReference: request.referenceAudio === undefined ? undefined : encodeBase64(request.referenceAudio),
    performanceReferencePromptId: request.voiceVariant,
    format: request.output.format,
    sampleRate: request.output.sampleRateHz,
    targetDuration: request.targetDurationSeconds,
    tempo: request.speed,
    variance: request.deliveryVariance,
    seed: request.randomSeed,
    temperature: request.temperature,
    promptBoost: request.voiceTuning?.speakerBoost,
    superStretch: request.durationStretching,
    realtime: request.latencyOptimization === undefined ? undefined : request.latencyOptimization === "aggressive",
    cleanAudio: request.audioEnhancement,
    autoGain: request.loudnessNormalization,
    accentControl: request.accentBlend === undefined ? undefined : {
      accentBaseLocale: request.accentBlend.baseLocale,
      accentLocale: request.accentBlend.targetLocale,
      accentRatio: request.accentBlend.ratio,
    },
    targetGender: request.targetGender,
  };
}
async function responseError(response: Response): Promise<TypeError> {
  const text = (await response.text()).trim();
  try {
    const value = JSON.parse(text) as { readonly message?: unknown };
    if (typeof value.message === "string") return new TypeError(`Deepdub returned HTTP ${response.status}: ${value.message}`);
  } catch {}
  return new TypeError(`Deepdub returned HTTP ${response.status}${text ? `: ${text}` : ""}`);
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array> {
  const response = await requestSpeech(input(request), client(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Deepdub returned no audio stream");
  yield* response.body;
}
