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

function lexicons(value: TtsRequest["lexicon"]): string[] | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? [value] : [...value];
}

function body(request: TtsRequest, text: string): SynthesizeSpeechInput {
  return {
    Text: text,
    VoiceId: request.voice as SynthesizeSpeechInput["VoiceId"],
    TextType: request.inputType,
    OutputFormat: request.output.format,
    SampleRate: request.output.sampleRateHz?.toString(),
    Engine: request.model,
    LanguageCode: request.language,
    LexiconNames: lexicons(request.lexicon),
  };
}

async function* actions(request: TtsRequest, text: AsyncIterable<string>) {
  for await (const chunk of text) {
    yield {
      TextEvent: {
        Text: chunk,
        ...(request.inputType ? { TextType: request.inputType } : {}),
      },
    } as const;
  }
  yield { CloseStreamEvent: {} } as const;
}

async function* streamingSynthesis(
  request: TtsRequest,
  text: AsyncIterable<string>,
  client: PollyStreamingClient,
  signal: AbortSignal | undefined,
): AsyncIterableIterator<Uint8Array> {
  const response = await client.start({
    Engine: "generative",
    LanguageCode: request.language,
    LexiconNames: lexicons(request.lexicon),
    OutputFormat: request.output.format,
    SampleRate: request.output.sampleRateHz?.toString(),
    VoiceId: request.voice,
    ActionStream: actions(request, text),
  }, signal);
  for await (const event of response.EventStream) {
    if ("AudioEvent" in event) yield event.AudioEvent.AudioChunk;
    else if ("ValidationException" in event) throw new TypeError(event.ValidationException.message);
    else if ("ServiceQuotaExceededException" in event) throw new TypeError(event.ServiceQuotaExceededException.message);
    else if ("ServiceFailureException" in event) throw new TypeError(event.ServiceFailureException.message);
    else if ("ThrottlingException" in event) throw new TypeError(event.ThrottlingException.message);
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
  const { text } = request;
  if (typeof text !== "string") {
    yield* streamingSynthesis(
      request,
      text,
      options.streamingClient ?? createPollyStreamingClient(region, credentials),
      options.signal,
    );
    return;
  }
  const response = await synthesizeSpeech(body(request, text), {
    baseUrl: `https://polly.${region}.amazonaws.com`,
    fetch,
    signal: options.signal ?? null,
  });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Amazon Polly returned no audio stream");
  yield* response.body;
}
