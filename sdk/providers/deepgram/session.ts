import type { TtsInput, TtsRequest } from "../../../schemas/providers/deepgram/index.ts";
import { validateInputItem } from "../../generated/validators/deepgram.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";

export function decodeFrame(data: unknown): Uint8Array | Record<string, unknown> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data !== "string")
    throw new TypeError("Deepgram returned an unsupported WebSocket frame");
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Deepgram returned an invalid WebSocket event");
  return value as Record<string, unknown>;
}

type ClientMessage = { readonly type: string; readonly text?: string };

/** Sending and receiving are independent; the messages iterator owns cleanup. */
export async function openSession<Message>({
  request,
  text,
  socket,
  signal,
  decode,
}: {
  request: TtsRequest;
  text: AsyncIterable<TtsInput>;
  socket: WebSocketLike;
  signal: AbortSignal;
  decode: (data: unknown) => Message;
}) {
  const lifetime = new AbortController();
  const sessionSignal = AbortSignal.any([signal, lifetime.signal]);
  const connection = await connectWebSocket({
    socket,
    signal: sessionSignal,
    decode,
    encode: (message: ClientMessage) => JSON.stringify(message),
  });
  let shutdown: "open" | "closing" = "open";
  let source: AsyncIterator<TtsInput> | undefined;
  let state: "reading" | "finished" | "stopped" = "reading";
  const stopInput = () => {
    if (state !== "reading") return;
    state = "stopped";
    try {
      // A stalled producer must not block cancellation of the socket or output.
      void Promise.resolve(source?.return?.()).catch(() => {});
    } catch {}
  };
  sessionSignal.addEventListener("abort", stopInput, { once: true });
  async function* input() {
    try {
      sessionSignal.throwIfAborted();
      source = text[Symbol.asyncIterator]();
      while (state === "reading") {
        const result = await source.next();
        sessionSignal.throwIfAborted();
        if (result.done) {
          state = "finished";
          return;
        }
        validateInputItem(request, result.value);
        yield result.value;
      }
    } finally {
      stopInput();
    }
  }
  async function* messages() {
    try {
      for await (const message of connection.messages) yield message;
      sessionSignal.throwIfAborted();
      if (shutdown !== "closing")
        throw new TypeError(
          "Deepgram WebSocket closed before input or pending synthesis completed",
        );
    } finally {
      sessionSignal.removeEventListener("abort", stopInput);
      stopInput();
      connection.close();
      lifetime.abort();
    }
  }
  return {
    send(message: ClientMessage) {
      sessionSignal.throwIfAborted();
      if (message.type === "Close") shutdown = "closing";
      connection.send(message);
    },
    abort(error: unknown) {
      lifetime.abort(error);
    },
    input: input(),
    messages: messages(),
  };
}
