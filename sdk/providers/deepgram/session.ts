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

/** Sending and receiving are independent; the receive iterator owns cleanup. */
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
  const connection = await connectWebSocket({
    socket,
    signal: AbortSignal.any([signal, lifetime.signal]),
    decode,
    encode: (message: ClientMessage) => JSON.stringify(message),
  });
  let shutdown: "open" | "closing" = "open";
  return {
    send(message: ClientMessage) {
      if (message.type === "Close") shutdown = "closing";
      connection.send(message);
    },
    async *receive({
      onInput,
      onInputEnd,
    }: {
      onInput(value: TtsInput): void;
      onInputEnd(): void;
    }) {
      let source: AsyncIterator<TtsInput> | undefined;
      let state: "reading" | "finished" | "stopped" = "reading";
      const stopInput = () => {
        if (state !== "reading") return;
        state = "stopped";
        try {
          void Promise.resolve(source?.return?.()).catch(() => {});
        } catch {}
      };
      try {
        signal.throwIfAborted();
        const iterator = text[Symbol.asyncIterator]();
        source = iterator;
        signal.addEventListener("abort", stopInput, { once: true });
        void (async () => {
          while (state === "reading") {
            const result = await iterator.next();
            if (state !== "reading") return;
            signal.throwIfAborted();
            if (result.done) {
              state = "finished";
              onInputEnd();
              return;
            }
            validateInputItem(request, result.value);
            onInput(result.value);
          }
        })().catch((error: unknown) => {
          stopInput();
          lifetime.abort(error);
        });
        for await (const message of connection.messages) yield message;
        signal.throwIfAborted();
        lifetime.signal.throwIfAborted();
        if (shutdown !== "closing")
          throw new TypeError(
            "Deepgram WebSocket closed before input or pending synthesis completed",
          );
      } finally {
        signal.removeEventListener("abort", stopInput);
        stopInput();
        connection.close();
      }
    },
  };
}
