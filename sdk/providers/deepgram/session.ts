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

/** Sends input independently of the consumer reading audio. */
export async function openSession<Message>(
  request: TtsRequest,
  text: AsyncIterable<TtsInput>,
  socket: WebSocketLike,
  signal: AbortSignal,
  decode: (data: unknown) => Message,
) {
  const lifetime = new AbortController();
  const connection = await connectWebSocket({
    socket,
    signal: AbortSignal.any([signal, lifetime.signal]),
    decode,
    encode: (message: { readonly type: string; readonly text?: string }) => JSON.stringify(message),
  });
  let state: "reading" | "finished" | "stopped" = "reading";
  let source: AsyncIterator<TtsInput>;
  try {
    source = text[Symbol.asyncIterator]();
  } catch (error) {
    connection.close();
    throw error;
  }
  const stopInput = () => {
    if (state !== "reading") return;
    state = "stopped";
    try {
      void Promise.resolve(source.return?.()).catch(() => {});
    } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  let shutdown: "open" | "closing" = "open";
  return {
    send: connection.send,
    start(consume: (value: TtsInput | undefined) => void) {
      void (async () => {
        for (;;) {
          signal.throwIfAborted();
          if (state !== "reading") return;
          const result = await source.next();
          if (state !== "reading") return;
          signal.throwIfAborted();
          if (result.done) {
            state = "finished";
            consume(undefined);
            return;
          }
          validateInputItem(request, result.value);
          consume(result.value);
        }
      })().catch((error: unknown) => {
        stopInput();
        lifetime.abort(error);
      });
    },
    finish() {
      shutdown = "closing";
      connection.send({ type: "Close" });
    },
    async *messages() {
      for await (const message of connection.messages) yield message;
      signal.throwIfAborted();
      lifetime.signal.throwIfAborted();
      if (shutdown !== "closing")
        throw new TypeError(
          "Deepgram WebSocket closed before input or pending synthesis completed",
        );
    },
    close() {
      signal.removeEventListener("abort", stopInput);
      stopInput();
      connection.close();
    },
  };
}
