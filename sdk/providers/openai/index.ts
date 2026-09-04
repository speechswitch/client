import type { TtsRequest } from "../../../schemas/providers/openai/index.ts";
import {
  createSpeech,
  defaultBaseUrl,
  type ClientOptions,
  type SpeechFormat,
} from "../../generated/clients/openai.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/openai/index.ts";

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
  const apiKey = options.auth?.openai?.apiKey
    ?? environment().SPEECHSWITCH_OPENAI_API_KEY
    ?? environment().OPENAI_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.openai.apiKey configuration");
  return {
    apiKey,
    baseUrl: options.baseUrl ?? defaultBaseUrl,
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function responseFormat(format: TtsRequest["output"]["format"]): SpeechFormat {
  return format === "ogg_opus" ? "opus" : format;
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`OpenAI returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const response = await createSpeech({
    model: request.model,
    input: request.text,
    voice: request.voiceSource === "custom" ? { id: request.voice } : request.voice,
    instructions: request.deliveryInstructions,
    response_format: responseFormat(request.output.format),
    speed: request.speed,
    stream_format: "audio",
  }, resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("OpenAI returned no audio stream");
  yield* response.body;
}
