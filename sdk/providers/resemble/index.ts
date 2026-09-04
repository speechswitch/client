import type { TtsRequest } from "../../../schemas/providers/resemble/index.ts";
import {
  download,
  predict,
  upload,
  type ChatterboxMultilingualRequest,
  type ChatterboxRequest,
  type ChatterboxTurboRequest,
  type ClientOptions,
  type FileData,
  type PredictionRequest,
} from "../../generated/clients/resemble.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/resemble/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
}

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  return {
    fetch: options.fetch ?? globalThis.fetch,
    token: options.auth?.resemble?.apiKey
      ?? environment().SPEECHSWITCH_RESEMBLE_API_KEY
      ?? environment().HF_TOKEN,
    baseUrl: options.baseUrl,
    signal: options.signal,
  };
}

function wireRequest(request: TtsRequest, reference: FileData | undefined): PredictionRequest {
  if (request.model === "chatterbox") {
    const input: ChatterboxRequest = {
      text_input: request.text,
      audio_prompt_path_input: reference,
      exaggeration_input: request.voiceTuning?.style ?? 0.5,
      temperature_input: request.temperature ?? 0.8,
      seed_num_input: request.randomSeed ?? 0,
      cfgw_input: request.guidanceScale ?? 0.5,
      vad_trim_input: request.referenceAudioTrimming ?? false,
    };
    return input;
  }
  if (request.model === "chatterbox-multilingual") {
    const input: ChatterboxMultilingualRequest = {
      text_input: request.text,
      audio_prompt_path_input: reference,
      language_id_input: request.language,
      exaggeration_input: request.voiceTuning?.style ?? 0.5,
      temperature_input: request.temperature ?? 0.8,
      seed_num_input: request.randomSeed ?? 0,
      cfgw_input: request.guidanceScale ?? 0.5,
    };
    return input;
  }
  const input: ChatterboxTurboRequest = {
    text: request.text,
    audio_prompt_path: reference,
    temperature: request.temperature ?? 0.8,
    seed_num: request.randomSeed ?? 0,
    min_p: request.minimumTokenProbability ?? 0,
    top_p: request.topProbabilityMass ?? 0.95,
    top_k: request.topTokenCount ?? 1000,
    repetition_penalty: request.repetitionPenalty ?? 1.2,
    norm_loudness: request.loudnessNormalization ?? true,
  };
  return input;
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const client = resolve(options);
  const reference = request.referenceAudio === undefined
    ? undefined
    : await upload(request.model, request.referenceAudio, client);
  const file = await predict(request.model, wireRequest(request, reference), client);
  const response = await download(file, request.model, client);
  if (!response.body) throw new TypeError("Resemble Chatterbox returned no audio stream");
  yield* response.body;
}
