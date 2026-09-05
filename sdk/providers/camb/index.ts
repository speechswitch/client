import type { TtsRequest } from "../../../schemas/providers/camb/index.ts";
import { streamSpeech, defaultBaseUrl, defaultWebSocketUrl, encodeMessage, decodeMessage, type HttpInput, type SessionStart } from "../../generated/clients/camb.ts";
import type { Auth } from "../../auth.ts";
import { validateRequest } from "../../generated/validators/camb.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsRequest } from "../../../schemas/providers/camb/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}

const models = {
  "mars8-flash": "mars-flash",
  "mars8-instruct": "mars-instruct",
  "mars8-pro": "mars-pro",
  "mars8.1-flash-beta": "mars-8.1-flash-beta",
  "mars8.1-pro-beta": "mars-8.1-pro-beta",
} as const;

async function* live(
  text: AsyncIterable<string>,
  start: SessionStart,
  socket: WebSocketLike,
  signal: AbortSignal,
  validateInput: (value: unknown) => void,
): AsyncIterableIterator<Uint8Array | SynthesisEnvelope<Timestamp<"word">>> {
  const connection = await connectWebSocket({ socket, signal, encode: encodeMessage, decode: decodeMessage });
  let source: AsyncIterator<string> | undefined;
  let inputDone = false;
  let stopped = false;
  const stopInput = () => {
    if (stopped || inputDone || !source) return;
    stopped = true;
    // return() may wait behind an unresolved next(); late input is never sent.
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  try {
    signal.throwIfAborted();
    connection.send(start);
    const ready = await connection.messages.next();
    if (ready.done) throw new TypeError("CAMB closed before session.ready");
    if (!(ready.value instanceof Uint8Array) && ready.value.type === "session.error") throw new TypeError(`CAMB rejected session: ${ready.value.error}`);
    if (ready.value instanceof Uint8Array || ready.value.type !== "session.ready") throw new TypeError("CAMB did not acknowledge the session before sending output");
    signal.throwIfAborted();
    source = text[Symbol.asyncIterator]();
    const iterator = source;
    const nextInput = () => Promise.resolve().then(() => { signal.throwIfAborted(); return iterator.next(); }).then(
      value => ({ kind: "input" as const, value }),
      error => ({ kind: "error" as const, error }),
    );
    const nextOutput = () => connection.messages.next().then(
      value => ({ kind: "output" as const, value }),
      error => ({ kind: "error" as const, error }),
    );
    let pendingInput = nextInput();
    let pendingOutput = nextOutput();
    let segment: number | undefined;
    let index = 0;
    const seen = new Set<number>();
    for (;;) {
      const event = await (inputDone ? pendingOutput : Promise.race([pendingOutput, pendingInput]));
      signal.throwIfAborted();
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        if (event.value.done) {
          inputDone = true;
          connection.send({ type: "text.done" });
        } else {
          validateInput(event.value.value);
          connection.send({ type: "text.chunk", text: event.value.value, index: index++ });
          pendingInput = nextInput();
        }
      } else {
        if (event.value.done) throw new TypeError("CAMB closed before session.done");
        const message = event.value.value;
        if (message instanceof Uint8Array) {
          if (segment === undefined) throw new TypeError("CAMB returned audio outside a segment");
          yield start.word_timestamps
            ? { correlation: "ordered", correlationId: String(segment), audio: message, timestamps: [] }
            : message;
        } else if (message.type === "segment.start") {
          if (segment !== undefined || seen.has(message.segment_id)) throw new TypeError("CAMB returned an overlapping or reused segment");
          segment = message.segment_id;
          seen.add(segment);
          if (start.word_timestamps) {
            yield {
              correlation: "ordered",
              correlationId: String(segment),
              timestamps: (message.word_timestamps ?? []).map(({ word, start, end }) => {
                if (start < 0 || end < start) throw new TypeError("CAMB returned invalid word timing");
                return { kind: "word", value: word, startTimeMs: start * 1000, endTimeMs: end * 1000 };
              }),
            };
          }
        } else if (message.type === "segment.done") {
          if (message.segment_id !== segment) throw new TypeError("CAMB completed an unexpected segment");
          segment = undefined;
        } else if (message.type === "segment.skipped") {
          // Failing explicitly avoids silently omitting spoken text. Retrying
          // automatically would move it after already-generated later segments.
          throw new TypeError(`CAMB skipped segment ${message.segment_id}: ${message.text}`);
        } else if (message.type === "session.error") {
          throw new TypeError(`CAMB synthesis failed: ${message.error}`);
        } else if (message.type === "session.done") {
          if (!inputDone || segment !== undefined) throw new TypeError("CAMB ended an incomplete session");
          return;
        } else throw new TypeError(`Unexpected CAMB event: ${message.type}`);
        pendingOutput = nextOutput();
      }
    }
  } finally {
    signal.removeEventListener("abort", stopInput);
    stopInput();
    connection.close();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array | SynthesisEnvelope<Timestamp<"word">>> {
  const validateInput = validateRequest(request);
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.camb?.apiKey ?? environment.SPEECHSWITCH_CAMB_API_KEY ?? environment.CAMB_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.camb.apiKey configuration");
  const voiceId = Number(request.voice);
  if (!Number.isSafeInteger(voiceId) || voiceId <= 0) throw new TypeError("CAMB voice must be a positive integer ID");
  const sampleRate = request.output.sampleRateHz;
  if (sampleRate !== undefined && !Number.isSafeInteger(sampleRate)) throw new TypeError("CAMB sampleRateHz must be a safe integer");
  if (typeof request.text === "string" && request.timestampGranularity === undefined) {
    const output = request.output;
    let format: NonNullable<HttpInput["output_configuration"]>["format"];
    if (output.format === "pcm") {
      const encodings = {
        signed_integer_16: { little_endian: "pcm_s16le", big_endian: "pcm_s16be" },
        signed_integer_32: { little_endian: "pcm_s32le", big_endian: "pcm_s32be" },
        float_32: { little_endian: "pcm_f32le", big_endian: "pcm_f32be" },
      } as const;
      format = encodings[output.sampleEncoding][output.byteOrder];
    } else format = output.format === "aac" ? "adts" : output.format;
    const response = await streamSpeech({
      text: request.text,
      voice_id: voiceId,
      language: request.language,
      speech_model: models[request.model],
      enhance_named_entities_pronunciation: request.namedEntityPronunciationEnhancement,
      output_configuration: { format, sample_rate: sampleRate, apply_enhancement: request.audioEnhancement },
      voice_settings: { speaking_rate: request.speed, enhance_reference_audio_quality: request.referenceAudioEnhancement, maintain_source_accent: request.accentPreservation },
    }, { apiKey, fetch: options.fetch ?? globalThis.fetch, baseUrl: options.baseUrl ?? defaultBaseUrl, signal });
    if (!response.ok) throw new TypeError(`CAMB returned HTTP ${response.status}: ${(await response.text()).trim()}`);
    if (!response.body) throw new TypeError("CAMB returned no audio stream");
    for await (const chunk of response.body) { signal.throwIfAborted(); yield chunk; }
    signal.throwIfAborted();
    return;
  }
  if (request.inferenceSteps !== undefined && !Number.isInteger(request.inferenceSteps)) throw new TypeError("CAMB inferenceSteps must be an integer");
  const start: SessionStart = {
    type: "session.start",
    voice_id: voiceId,
    language: request.language,
    // The generated request check and transport branch exclude PCM; TS does not narrow the nested output union here.
    output_format: request.output.format as SessionStart["output_format"],
    sample_rate: sampleRate,
    word_timestamps: request.timestampGranularity === "word",
    idle_timeout: request.textFlushDelayMs === undefined ? 1 : request.textFlushDelayMs / 1000,
    inference_steps: request.inferenceSteps,
    speaking_rate: request.speed,
    enhance_named_entities_pronunciation: request.namedEntityPronunciationEnhancement ?? false,
    apply_enhancement: request.audioEnhancement,
    enhance_reference_audio_quality: request.referenceAudioEnhancement ?? false,
    maintain_source_accent: request.accentPreservation ?? false,
  };
  const text = request.text;
  const source = typeof text === "string" ? (async function* () { yield text; })() : text;
  const validateText = typeof text === "string" ? validateRequest({ ...request, text: source }) : validateInput;
  const url = new URL(options.webSocketUrl ?? defaultWebSocketUrl);
  // Query authentication is documented for native clients that cannot set headers.
  url.searchParams.set("api_key", apiKey);
  const socket = options.webSocket ?? new globalThis.WebSocket(url.href);
  yield* live(source, start, socket, signal, validateText);
}
