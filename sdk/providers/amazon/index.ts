import {
  startSpeechSynthesisStream,
  synthesizeSpeech,
  type SpeechMarkType,
  type StartSpeechSynthesisStreamInput,
  type SynthesizeSpeechInput,
} from "../../generated/clients/amazon-polly.ts";
import type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/amazon/index.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope } from "../../timestamps.ts";
import { processEnvironment, resolveAwsAuth } from "./aws-auth.ts";
import {
  createAwsEventStreamClient,
  type AwsEventStreamClient,
} from "../../runtime/aws/event-stream.ts";

export type {
  TtsRequest,
  TtsRequestWithTimestamps,
} from "../../../schemas/providers/amazon/index.ts";
export type { AwsEventStreamClient } from "../../runtime/aws/event-stream.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly eventStream?: AwsEventStreamClient;
  readonly signal?: AbortSignal;
}

export interface Timestamp {
  readonly kind: SpeechMarkType;
  readonly value: string;
  readonly startTimeMs: number;
  readonly endTimeMs?: number;
  readonly source?: { readonly start: number; readonly end: number };
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
  baseUrl: string,
  eventStream: AwsEventStreamClient,
  signal: AbortSignal | undefined,
): AsyncIterableIterator<Uint8Array> {
  const response = await startSpeechSynthesisStream({
    Engine: "generative",
    LanguageCode: request.language,
    LexiconNames: lexicons(request.lexicon),
    OutputFormat: request.output.format,
    SampleRate: request.output.sampleRateHz?.toString(),
    VoiceId: request.voice as StartSpeechSynthesisStreamInput["VoiceId"],
    ActionStream: actions(request, text),
  }, {
    baseUrl,
    eventStream,
    signal,
  });
  if (!response.EventStream) throw new TypeError("Amazon Polly returned no event stream");
  for await (const event of response.EventStream) {
    if (event.AudioChunk) yield event.AudioChunk;
  }
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Amazon Polly returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

const speechMarkTypes: ReadonlySet<string> = new Set([
  "sentence",
  "ssml",
  "viseme",
  "word",
]);

function parseSpeechMark(line: string, index: number): Timestamp {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object") throw new TypeError("Expected an object");
    const mark = value as Record<string, unknown>;
    if (
      typeof mark.time !== "number" ||
      typeof mark.type !== "string" ||
      !speechMarkTypes.has(mark.type) ||
      typeof mark.value !== "string"
    ) {
      throw new TypeError("Missing speech mark fields");
    }
    return {
      kind: mark.type as SpeechMarkType,
      value: mark.value,
      startTimeMs: mark.time,
      ...(typeof mark.start === "number" && typeof mark.end === "number"
        ? { source: { start: mark.start, end: mark.end } }
        : {}),
    };
  } catch (cause) {
    throw new TypeError(`Invalid Polly speech mark at line ${index + 1}`, { cause });
  }
}

async function* speechMarks(
  response: Promise<Response>,
): AsyncIterableIterator<Timestamp> {
  const resolved = await response;
  if (!resolved.ok) throw await responseError(resolved);
  if (!resolved.body) throw new TypeError("Amazon Polly returned no speech-mark stream");

  const decoder = new TextDecoder();
  let buffer = "";
  let index = 0;
  for await (const chunk of resolved.body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line) yield parseSpeechMark(line, index++);
    }
  }
  const line = `${buffer}${decoder.decode()}`.replace(/\r$/, "");
  if (line) yield parseSpeechMark(line, index);
}

async function* audioChunks(
  response: Promise<Response>,
): AsyncIterableIterator<Uint8Array> {
  const resolved = await response;
  if (!resolved.ok) throw await responseError(resolved);
  if (!resolved.body) throw new TypeError("Amazon Polly returned no audio stream");
  yield* resolved.body;
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
      `https://polly.${region}.amazonaws.com`,
      options.eventStream ?? createAwsEventStreamClient(region, "polly", credentials),
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

export async function* synthesizeWithTimestamps(
  request: TtsRequestWithTimestamps,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<SynthesisEnvelope<Timestamp>> {
  const { region, fetch } = resolveAwsAuth(
    { auth: options.auth, fetch: options.fetch },
    processEnvironment(),
  );
  const clientOptions = {
    baseUrl: `https://polly.${region}.amazonaws.com`,
    fetch,
    signal: options.signal ?? null,
  };
  const audioResponse = synthesizeSpeech(body(request, request.text), clientOptions);
  const marksResponse = synthesizeSpeech({
    ...body(request, request.text),
    OutputFormat: "json",
    SpeechMarkTypes: request.timestampKinds,
  }, clientOptions);
  const audio = audioChunks(audioResponse);
  const marks = speechMarks(marksResponse);
  type Next =
    | { readonly source: "audio"; readonly result: IteratorResult<Uint8Array> }
    | { readonly source: "marks"; readonly result: IteratorResult<Timestamp> };
  const nextAudio = (): Promise<Next> =>
    audio.next().then((result) => ({ source: "audio", result }));
  const nextMark = (): Promise<Next> =>
    marks.next().then((result) => ({ source: "marks", result }));
  let pendingAudio: Promise<Next> | undefined = nextAudio();
  let pendingMark: Promise<Next> | undefined = nextMark();

  try {
    while (pendingAudio || pendingMark) {
      const pending = [pendingAudio, pendingMark].filter(
        (value): value is Promise<Next> => value !== undefined,
      );
      const next = await Promise.race(pending);
      if (next.source === "audio") {
        if (next.result.done) {
          pendingAudio = undefined;
        } else {
          pendingAudio = undefined;
          yield {
            correlation: "timeline",
            audio: next.result.value,
            timestamps: [],
          };
          pendingAudio = nextAudio();
        }
      } else if (next.result.done) {
        pendingMark = undefined;
      } else {
        pendingMark = undefined;
        yield {
          correlation: "timeline",
          timestamps: [next.result.value],
        };
        pendingMark = nextMark();
      }
    }
  } finally {
    const audioReturn = audio.return?.();
    const marksReturn = marks.return?.();
    if (audioReturn) void audioReturn.catch(() => undefined);
    if (marksReturn) void marksReturn.catch(() => undefined);
  }
}
