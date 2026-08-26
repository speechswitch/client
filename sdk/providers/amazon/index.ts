import { synthesizeSpeech, type SynthesizeSpeechInput } from "../../../generated/clients/amazon-polly.ts";
import type { TtsRequest } from "../../../schemas/providers/amazon/index.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../fetch.ts";
import { processEnvironment, resolveAwsAuth } from "./aws-auth.ts";

export type { TtsRequest } from "../../../schemas/providers/amazon/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly signal?: AbortSignal;
}

function lexicons(value: TtsRequest["lexicon"]): readonly string[] | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? [value] : value;
}

function body(request: TtsRequest): SynthesizeSpeechInput {
  return {
    Text: request.text,
    VoiceId: request.voice as SynthesizeSpeechInput["VoiceId"],
    TextType: request.inputType,
    OutputFormat: request.format,
    SampleRate: request.sampleRateHz?.toString(),
    Engine: request.model,
    LanguageCode: request.language,
    LexiconNames: lexicons(request.lexicon),
  };
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Amazon Polly returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const { region, fetch } = resolveAwsAuth(
    { auth: options.auth, fetch: options.fetch },
    processEnvironment(),
  );
  const response = await synthesizeSpeech(body(request), {
    baseUrl: `https://polly.${region}.amazonaws.com`,
    fetch,
    signal: options.signal ?? null,
  });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Amazon Polly returned no audio stream");
  yield* response.body;
}
