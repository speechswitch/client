import { synthesizeSpeech, type SynthesizeSpeechInput } from "../../../generated/clients/amazon-polly.ts";
import type { TtsRequest } from "../../../schemas/providers/amazon/index.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../fetch.ts";
import { processEnvironment, resolveAwsAuth } from "./aws-auth.ts";
import {
  createPollyStreamingClient,
  type PollyStreamingClient,
} from "./aws-event-stream.ts";

export type { TtsRequest } from "../../../schemas/providers/amazon/index.ts";
export type { PollyStreamingClient } from "./aws-event-stream.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly streamingClient?: PollyStreamingClient;
  readonly signal?: AbortSignal;
}

type CompleteRequest = Extract<TtsRequest, { readonly text: string }>;
type StreamingRequest = Extract<TtsRequest, { readonly text: AsyncIterable<string> }>;

function lexicons(value: TtsRequest["lexicon"]): string[] | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? [value] : [...value];
}

function isStreaming(request: TtsRequest): request is StreamingRequest {
  return typeof request.text !== "string";
}

function body(request: CompleteRequest): SynthesizeSpeechInput {
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

async function* actions(request: StreamingRequest) {
  for await (const text of request.text) {
    yield {
      TextEvent: {
        Text: text,
        ...(request.inputType ? { TextType: request.inputType } : {}),
      },
    } as const;
  }
  yield { CloseStreamEvent: {} } as const;
}

async function* streamingSynthesis(
  request: StreamingRequest,
  client: PollyStreamingClient,
  signal: AbortSignal | undefined,
): AsyncIterableIterator<Uint8Array> {
  const response = await client.start({
    Engine: request.model,
    LanguageCode: request.language,
    LexiconNames: lexicons(request.lexicon),
    OutputFormat: request.format,
    SampleRate: request.sampleRateHz?.toString(),
    VoiceId: request.voice as Parameters<PollyStreamingClient["start"]>[0]["VoiceId"],
    ActionStream: actions(request),
  }, signal);
  if (!response.EventStream) throw new TypeError("Amazon Polly returned no event stream");
  for await (const event of response.EventStream) {
    if (event.AudioEvent?.AudioChunk) yield event.AudioEvent.AudioChunk;
    else if (event.ValidationException) throw new TypeError(event.ValidationException.message);
    else if (event.ServiceQuotaExceededException) throw new TypeError(event.ServiceQuotaExceededException.message);
    else if (event.ServiceFailureException) throw new TypeError(event.ServiceFailureException.message);
    else if (event.ThrottlingException) throw new TypeError(event.ThrottlingException.message);
    else if (event.$unknown) throw new TypeError(`Amazon Polly returned unknown event ${event.$unknown[0]}`);
  }
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Amazon Polly returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const { region, credentials, fetch } = resolveAwsAuth(
    { auth: options.auth, fetch: options.fetch },
    processEnvironment(),
  );
  if (isStreaming(request)) {
    yield* streamingSynthesis(
      request,
      options.streamingClient ?? createPollyStreamingClient(region, credentials),
      options.signal,
    );
    return;
  }
  const response = await synthesizeSpeech(body(request), {
    baseUrl: `https://polly.${region}.amazonaws.com`,
    fetch,
    signal: options.signal ?? null,
  });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Amazon Polly returned no audio stream");
  yield* response.body;
}
