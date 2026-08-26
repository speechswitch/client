import { once } from "node:events";
import { connect, type ClientHttp2Stream } from "node:http2";
import { crc32 } from "node:zlib";
import { signAwsEvent, signAwsRequest, type AwsCredentials } from "./aws-sigv4.ts";

type HeaderValue =
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | Date;

interface EventStreamMessage {
  readonly headers: Readonly<Record<string, HeaderValue>>;
  readonly body: Uint8Array;
}

export type PollyStreamingAction =
  | { readonly TextEvent: { readonly Text: string; readonly TextType?: "text" | "ssml" } }
  | { readonly CloseStreamEvent: Record<never, never> };

export interface PollyStreamingInput {
  readonly Engine: "generative";
  readonly LanguageCode?: string;
  readonly LexiconNames?: readonly string[];
  readonly OutputFormat: string;
  readonly SampleRate?: string;
  readonly VoiceId: string;
  readonly ActionStream: AsyncIterable<PollyStreamingAction>;
}

export type PollyStreamingEvent =
  | { readonly AudioEvent: { readonly AudioChunk: Uint8Array } }
  | { readonly StreamClosedEvent: { readonly RequestCharacters?: number } }
  | { readonly ValidationException: { readonly message?: string } }
  | { readonly ServiceQuotaExceededException: { readonly message?: string } }
  | { readonly ServiceFailureException: { readonly message?: string } }
  | { readonly ThrottlingException: { readonly message?: string } };

export interface PollyStreamingOutput {
  readonly EventStream: AsyncIterable<PollyStreamingEvent>;
}

export interface PollyStreamingClient {
  start(input: PollyStreamingInput, signal: AbortSignal | undefined): Promise<PollyStreamingOutput>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function sized(tag: number, bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(3 + bytes.byteLength);
  const view = new DataView(output.buffer);
  output[0] = tag;
  view.setUint16(1, bytes.byteLength, false);
  output.set(bytes, 3);
  return output;
}

function headerValue(value: HeaderValue): Uint8Array {
  if (typeof value === "boolean") return Uint8Array.of(value ? 0 : 1);
  if (typeof value === "string") return sized(7, encoder.encode(value));
  if (value instanceof Uint8Array) return sized(6, value);
  const output = new Uint8Array(9);
  const view = new DataView(output.buffer);
  if (value instanceof Date) {
    output[0] = 8;
    view.setBigInt64(1, BigInt(value.valueOf()), false);
  } else if (typeof value === "bigint") {
    output[0] = 5;
    view.setBigInt64(1, value, false);
  } else {
    output[0] = 4;
    view.setInt32(1, value, false);
    return output.subarray(0, 5);
  }
  return output;
}

function encodeHeaders(headers: EventStreamMessage["headers"]): Uint8Array {
  return concat(Object.entries(headers).flatMap(([name, value]) => {
    const bytes = encoder.encode(name);
    if (bytes.byteLength > 255) throw new TypeError(`AWS event header is too long: ${name}`);
    return [Uint8Array.of(bytes.byteLength), bytes, headerValue(value)];
  }));
}

function encodeMessage(message: EventStreamMessage): Uint8Array {
  const headers = encodeHeaders(message.headers);
  const output = new Uint8Array(16 + headers.byteLength + message.body.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, output.byteLength, false);
  view.setUint32(4, headers.byteLength, false);
  view.setUint32(8, crc32(output.subarray(0, 8)), false);
  output.set(headers, 12);
  output.set(message.body, 12 + headers.byteLength);
  view.setUint32(output.byteLength - 4, crc32(output.subarray(0, -4)), false);
  return output;
}

function readHeaderValue(view: DataView, offset: number): readonly [HeaderValue, number] {
  const tag = view.getUint8(offset++);
  if (tag === 0 || tag === 1) return [tag === 0, offset];
  if (tag === 2) return [view.getInt8(offset), offset + 1];
  if (tag === 3) return [view.getInt16(offset, false), offset + 2];
  if (tag === 4) return [view.getInt32(offset, false), offset + 4];
  if (tag === 5) return [view.getBigInt64(offset, false), offset + 8];
  if (tag === 8) return [new Date(Number(view.getBigInt64(offset, false))), offset + 8];
  if (tag === 9) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, 16);
    const hex = Buffer.from(bytes).toString("hex");
    return [`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`, offset + 16];
  }
  if (tag === 6 || tag === 7) {
    const length = view.getUint16(offset, false);
    offset += 2;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    return [tag === 6 ? bytes.slice() : decoder.decode(bytes), offset + length];
  }
  throw new TypeError(`Unsupported AWS event header type ${tag}`);
}

function decodeMessage(bytes: Uint8Array): EventStreamMessage {
  if (bytes.byteLength < 16) throw new TypeError("AWS event message is shorter than its framing");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(0, false);
  const headerLength = view.getUint32(4, false);
  if (length !== bytes.byteLength || headerLength > length - 16) throw new TypeError("Invalid AWS event message length");
  if (view.getUint32(8, false) !== crc32(bytes.subarray(0, 8))) throw new TypeError("Invalid AWS event prelude checksum");
  if (view.getUint32(length - 4, false) !== crc32(bytes.subarray(0, -4))) throw new TypeError("Invalid AWS event message checksum");
  const headers: Record<string, HeaderValue> = {};
  let offset = 12;
  const headerEnd = offset + headerLength;
  while (offset < headerEnd) {
    const nameLength = view.getUint8(offset++);
    const name = decoder.decode(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, nameLength));
    offset += nameLength;
    const [value, next] = readHeaderValue(view, offset);
    headers[name] = value;
    offset = next;
  }
  if (offset !== headerEnd) throw new TypeError("Invalid AWS event headers");
  return { headers, body: bytes.slice(headerEnd, length - 4) };
}

async function* messages(stream: AsyncIterable<Uint8Array>): AsyncIterableIterator<EventStreamMessage> {
  let buffered: Uint8Array<ArrayBufferLike> = new Uint8Array();
  for await (const chunk of stream) {
    buffered = concat([buffered, chunk]);
    while (buffered.byteLength >= 4) {
      const length = new DataView(buffered.buffer, buffered.byteOffset, buffered.byteLength).getUint32(0, false);
      if (length < 16) throw new TypeError("Invalid AWS event message length");
      if (buffered.byteLength < length) break;
      yield decodeMessage(buffered.slice(0, length));
      buffered = buffered.slice(length);
    }
  }
  if (buffered.byteLength) throw new TypeError("Truncated AWS event message");
}

export function encodePollyStreamingAction(action: PollyStreamingAction): Uint8Array {
  const [type, value] = "TextEvent" in action
    ? ["TextEvent", action.TextEvent] as const
    : ["CloseStreamEvent", action.CloseStreamEvent] as const;
  return encodeMessage({
    headers: {
      ":event-type": type,
      ":message-type": "event",
      ":content-type": "application/json",
    },
    body: encoder.encode(JSON.stringify(value)),
  });
}

export function encodeSignedEventStreamMessage(
  payload: Uint8Array,
  priorSignature: string,
  credentials: AwsCredentials,
  region: string,
  date = new Date(),
): readonly [Uint8Array, string] {
  const signingHeaders = encodeHeaders({ ":date": date });
  const signature = signAwsEvent(signingHeaders, payload, priorSignature, {
    ...credentials,
    region,
    service: "polly",
  }, date);
  return [encodeMessage({
    headers: { ":date": date, ":chunk-signature": Buffer.from(signature, "hex") },
    body: payload,
  }), signature];
}

async function writeActions(
  stream: ClientHttp2Stream,
  actions: AsyncIterable<PollyStreamingAction>,
  signature: string,
  credentials: AwsCredentials,
  region: string,
): Promise<void> {
  let priorSignature = signature;
  for await (const action of actions) {
    const [frame, nextSignature] = encodeSignedEventStreamMessage(
      encodePollyStreamingAction(action),
      priorSignature,
      credentials,
      region,
    );
    priorSignature = nextSignature;
    if (!stream.write(frame)) await once(stream, "drain");
  }
  stream.end();
}

function json(bytes: Uint8Array): Record<string, unknown> {
  if (!bytes.byteLength) return {};
  return JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
}

async function* responseEvents(stream: ClientHttp2Stream): AsyncIterableIterator<PollyStreamingEvent> {
  for await (const message of messages(stream)) {
    const messageType = message.headers[":message-type"];
    const eventType = messageType === "exception"
      ? message.headers[":exception-type"]
      : message.headers[":event-type"];
    if (typeof eventType !== "string") throw new TypeError("Amazon Polly returned an event without a type");
    if (messageType === "error") {
      const detail = message.headers[":error-message"];
      throw new TypeError(typeof detail === "string" ? detail : `Amazon Polly returned ${eventType}`);
    }
    if (eventType === "AudioEvent") yield { AudioEvent: { AudioChunk: message.body } };
    else if (eventType === "StreamClosedEvent") yield { StreamClosedEvent: json(message.body) } as PollyStreamingEvent;
    else if (["ValidationException", "ServiceQuotaExceededException", "ServiceFailureException", "ThrottlingException"].includes(eventType)) {
      yield { [eventType]: json(message.body) } as PollyStreamingEvent;
    } else {
      throw new TypeError(`Amazon Polly returned unknown event ${eventType}`);
    }
  }
}

export function createPollyStreamingClient(
  region: string,
  credentials: AwsCredentials,
): PollyStreamingClient {
  return {
    async start(input, signal) {
      const url = new URL(`https://polly.${region}.amazonaws.com/v1/synthesisStream`);
      const headers = {
        "content-type": "application/vnd.amazon.eventstream",
        "x-amzn-engine": input.Engine,
        "x-amzn-outputformat": input.OutputFormat,
        "x-amzn-voiceid": input.VoiceId,
        ...(input.LanguageCode ? { "x-amzn-languagecode": input.LanguageCode } : {}),
        ...(input.LexiconNames?.length ? { "x-amzn-lexiconnames": input.LexiconNames.join(", ") } : {}),
        ...(input.SampleRate ? { "x-amzn-samplerate": input.SampleRate } : {}),
      };
      const signed = signAwsRequest(
        "POST",
        url,
        headers,
        "STREAMING-AWS4-HMAC-SHA256-EVENTS",
        { ...credentials, region, service: "polly" },
      );
      const session = connect(url.origin);
      const stream = session.request({ ":method": "POST", ":path": url.pathname, ...signed.headers });
      session.once("error", (error) => stream.destroy(error));
      const abort = () => stream.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      const writing = writeActions(stream, input.ActionStream, signed.signature, credentials, region)
        .catch((error: unknown) => {
          stream.destroy(error instanceof Error ? error : new Error(String(error)));
          throw error;
        });
      let responseHeaders: Readonly<Record<string, string | string[] | undefined>>;
      try {
        [responseHeaders] = await once(stream, "response") as [typeof responseHeaders];
      } catch (error) {
        signal?.removeEventListener("abort", abort);
        session.destroy();
        await writing.catch(() => undefined);
        throw error;
      }
      const status = Number(responseHeaders[":status"]);
      if (status !== 200) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        session.close();
        await writing.catch(() => undefined);
        throw new TypeError(`Amazon Polly returned HTTP ${status}: ${decoder.decode(concat(chunks)).trim()}`);
      }
      return {
        EventStream: (async function* () {
          try {
            yield* responseEvents(stream);
            await writing;
          } finally {
            signal?.removeEventListener("abort", abort);
            stream.close();
            session.close();
          }
        })(),
      };
    },
  };
}
