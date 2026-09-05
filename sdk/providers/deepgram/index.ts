import type { TtsInput, TtsRequest } from "../../../schemas/providers/deepgram/index.ts";
import type { Auth } from "../../auth.ts";
import { validateRequest } from "../../generated/validators/deepgram.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export type { TtsInput, TtsRequest } from "../../../schemas/providers/deepgram/index.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}
export interface ClearEvent { readonly event: "clear"; readonly sequenceId: number }
export interface DoneEvent { readonly event: "done"; readonly sequenceId: number; readonly traceId?: string }
export type StreamEvent = ClearEvent | DoneEvent;

type ClientMessage = { readonly type: "Speak"; readonly text: string } | { readonly type: "Flush" | "Clear" | "Close" };
type ServerMessage = Uint8Array
  | { readonly type: "Metadata"; readonly request_id: string }
  | { readonly type: "Flushed" | "Cleared"; readonly sequence_id: number };

function decodeMessage(data: unknown): ServerMessage {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data !== "string") throw new TypeError("Deepgram returned an unsupported WebSocket frame");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Deepgram returned an invalid WebSocket event");
  const message = value as Record<string, unknown>;
  if (message.type === "Warning" || message.type === "Error") {
    // A rejected Flush may never be acknowledged; do not silently wait forever.
    if (typeof message.code !== "string" || typeof message.description !== "string") {
      throw new TypeError("Deepgram returned an invalid error event");
    }
    throw new TypeError(`Deepgram ${message.type} ${message.code}: ${message.description}`);
  }
  if (message.type === "Metadata" && typeof message.request_id === "string") return { type: "Metadata", request_id: message.request_id };
  if ((message.type === "Flushed" || message.type === "Cleared")
    && typeof message.sequence_id === "number" && Number.isSafeInteger(message.sequence_id) && message.sequence_id >= 0) {
    return { type: message.type, sequence_id: message.sequence_id };
  }
  throw new TypeError("Deepgram returned an invalid WebSocket event");
}

function speechUrl(request: TtsRequest, endpoint: string, streaming: boolean): URL {
  const url = new URL(endpoint);
  const output = request.output;
  const encoding = output.format === "pcm" ? "linear16"
    : output.format === "wav" ? output.sampleEncoding === "mulaw" || output.sampleEncoding === "alaw" ? output.sampleEncoding : "linear16"
    : output.format === "ogg_opus" ? "opus" : output.format;
  url.searchParams.set("model", `${request.model === "aura-1" ? "aura" : "aura-2"}-${request.voice}-${request.language}`);
  url.searchParams.set("encoding", encoding);
  if (!streaming) {
    if (output.format === "wav") url.searchParams.set("container", "wav");
    else if (output.format === "pcm" || output.format === "mulaw" || output.format === "alaw") url.searchParams.set("container", "none");
    else if (output.format === "ogg_opus") url.searchParams.set("container", "ogg");
  }
  // Fixed-rate codecs allow the normalized rate for clarity, but reject it as a wire query parameter.
  if (output.sampleRateHz !== undefined && output.format !== "mp3" && output.format !== "ogg_opus" && output.format !== "aac") {
    url.searchParams.set("sample_rate", String(output.sampleRateHz));
  }
  if (output.bitRateBps !== undefined) url.searchParams.set("bit_rate", String(output.bitRateBps));
  if (request.speed !== undefined) url.searchParams.set("speed", String(request.speed));
  if (request.modelImprovementOptOut !== undefined) url.searchParams.set("mip_opt_out", String(request.modelImprovementOptOut));
  for (const tag of request.tags ?? []) url.searchParams.append("tag", tag);
  return url;
}

async function* streaming(
  text: AsyncIterable<TtsInput>, socket: WebSocketLike, signal: AbortSignal, validateInput: (value: unknown) => void,
): AsyncIterableIterator<Uint8Array | StreamEvent> {
  const connection = await connectWebSocket({ socket, signal, encode: (message: ClientMessage) => JSON.stringify(message), decode: decodeMessage });
  let source: AsyncIterator<TtsInput>;
  try { source = text[Symbol.asyncIterator](); } catch (error) { connection.close(); throw error; }
  let inputDone = false;
  let stopped = false;
  let hasText = false;
  let flushing = false;
  let clearing = false;
  let traceId: string | undefined;
  const stopInput = () => {
    if (stopped || inputDone) return;
    stopped = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  try {
    const nextInput = () => Promise.resolve().then(() => source.next()).then(
      value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }),
    );
    const nextOutput = () => connection.messages.next().then(
      value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }),
    );
    let pendingInput = nextInput();
    let pendingOutput = nextOutput();
    let held: IteratorResult<TtsInput> | undefined;
    let preferInput = true;
    for (;;) {
      signal.throwIfAborted();
      if (inputDone && !hasText && !flushing && !clearing) { connection.send({ type: "Close" }); return; }
      const availableInput = held
        ? !flushing && !clearing ? Promise.resolve({ kind: "input" as const, value: held }) : undefined
        : inputDone ? undefined : pendingInput;
      const event = await Promise.race(!availableInput ? [pendingOutput]
        : preferInput ? [availableInput, pendingOutput] : [pendingOutput, availableInput]);
      preferInput = !preferInput;
      signal.throwIfAborted();
      if (event.kind === "error") throw event.error;
      if (event.kind === "input") {
        const result = event.value;
        if (!result.done) validateInput(result.value);
        // Clear can interrupt a flush. New text waits for acknowledgement to prevent cross-utterance audio.
        if (clearing || (flushing && (result.done || typeof result.value === "string" || result.value.command === "flush"))) {
          held = result;
          continue;
        }
        held = undefined;
        if (result.done) {
          inputDone = true;
          if (hasText) { hasText = false; flushing = true; connection.send({ type: "Flush" }); }
        } else {
          const value = result.value;
          if (typeof value === "string") {
            if (value.length) { hasText = true; connection.send({ type: "Speak", text: value }); }
          } else if (value.command === "clear") {
            clearing = true; hasText = false;
            connection.send({ type: "Clear" });
          } else if (hasText) {
            hasText = false; flushing = true;
            connection.send({ type: "Flush" });
          }
          pendingInput = nextInput();
        }
        continue;
      }
      if (event.value.done) throw new TypeError("Deepgram WebSocket closed before input or pending synthesis completed");
      const message = event.value.value;
      pendingOutput = nextOutput();
      if (message instanceof Uint8Array) {
        if (!clearing) yield message;
      } else if (message.type === "Metadata") traceId = message.request_id;
      else if (message.type === "Cleared") {
        if (!clearing) throw new TypeError("Unexpected Deepgram Cleared acknowledgement");
        clearing = false; flushing = false;
        yield { event: "clear", sequenceId: message.sequence_id };
      } else {
        if (clearing) continue;
        if (!flushing) throw new TypeError("Unexpected Deepgram Flushed acknowledgement");
        flushing = false;
        yield { event: "done", sequenceId: message.sequence_id, ...(traceId === undefined ? {} : { traceId }) };
      }
    }
  } finally {
    signal.removeEventListener("abort", stopInput);
    stopInput();
    connection.close();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array | StreamEvent> {
  const validateInput = validateRequest(request);
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.deepgram?.apiKey ?? environment.SPEECHSWITCH_DEEPGRAM_API_KEY ?? environment.DEEPGRAM_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.deepgram.apiKey configuration");
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  if (typeof request.text !== "string") {
    let socket = options.webSocket;
    if (!socket) {
      if (typeof globalThis.WebSocket !== "function") throw new TypeError("This runtime does not provide WebSocket");
      if (typeof Bun === "undefined" && !(typeof process !== "undefined" && process.versions?.node)) {
        throw new TypeError("Deepgram native WebSocket authentication requires Node or Bun; inject an authenticated WebSocket in browsers");
      }
      const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
      socket = new Constructor(speechUrl(request, options.webSocketUrl ?? "wss://api.deepgram.com/v1/speak", true).href,
        { headers: { authorization: `Token ${apiKey}` } });
    }
    yield* streaming(request.text, socket, signal, validateInput);
    return;
  }
  const baseUrl = new URL(options.baseUrl ?? "https://api.deepgram.com");
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/v1/speak`;
  const response = await (options.fetch ?? globalThis.fetch)(speechUrl(request, baseUrl.href, false), {
    method: "POST", headers: { authorization: `Token ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ text: request.text }), signal,
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new TypeError(`Deepgram returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  if (!response.body) throw new TypeError("Deepgram returned no audio stream");
  yield* response.body;
}
