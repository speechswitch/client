import type { TtsInput, TtsRequest } from "../../../schemas/providers/deepgram/index.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";
import { validateInputItem } from "../../generated/validators/deepgram.ts";

type Message =
  | {
      type:
        | "Connected"
        | "SessionMetadata"
        | "SpeechStarted"
        | "SpeechMetadata"
        | "Flushed"
        | "SpeechInterrupted";
    }
  | { type: "Warning" | "Error"; code: string; description: string };

export async function* streamFlux(
  request: TtsRequest,
  text: AsyncIterable<TtsInput>,
  socket: WebSocketLike,
  signal: AbortSignal,
): AsyncIterableIterator<Uint8Array> {
  const lifetime = new AbortController();
  signal = AbortSignal.any([signal, lifetime.signal]);
  const connection = await connectWebSocket({
    socket,
    signal,
    encode: (message: { type: string; text?: string }) => JSON.stringify(message),
    decode: (data): Message | Uint8Array =>
      typeof data === "string" ? JSON.parse(data) : new Uint8Array(data as ArrayBuffer),
  });
  let closeSent = false;

  let buffer: "empty" | "text" = "empty";
  let interruptions = 0;
  const flush = () => {
    if (buffer === "text") {
      buffer = "empty";
      connection.send({ type: "Flush" });
    }
  };
  void (async () => {
    signal.throwIfAborted();
    const source = text[Symbol.asyncIterator]();
    const stopInput = () => {
      try {
        // Do not wait for a stalled producer to finish returning.
        void Promise.resolve(source.return?.()).catch(() => {});
      } catch {}
    };
    signal.addEventListener("abort", stopInput, { once: true });
    while (!signal.aborted) {
      const result = await source.next();
      signal.throwIfAborted();
      if (result.done) {
        signal.removeEventListener("abort", stopInput);
        break;
      }
      const value = result.value;
      validateInputItem(request, value);
      if (typeof value === "string") {
        if (value) {
          buffer = "text";
          connection.send({ type: "Speak", text: value });
        }
      } else if (value.command === "clear") {
        interruptions++;
        connection.send({ type: "Interrupt" });
      } else flush();
    }
    signal.throwIfAborted();
    flush();
    closeSent = true;
    connection.send({ type: "Close" });
  })().catch((error: unknown) => lifetime.abort(error));
  try {
    for await (const message of connection.messages) {
      if (message instanceof Uint8Array) {
        if (interruptions === 0) yield message;
        continue;
      }
      switch (message.type) {
        case "Connected":
        case "SessionMetadata":
        case "SpeechStarted":
        case "SpeechMetadata":
        case "Flushed":
          break;
        case "SpeechInterrupted":
          if (interruptions > 0) interruptions--;
          break;
        case "Error":
          throw new TypeError(`Deepgram Error ${message.code}: ${message.description}`);
        case "Warning":
          // An interrupt can leave no active speech for a subsequent Flush.
          if (
            message.code !== "NO_ACTIVE_SPEECH" &&
            message.code !== "NO_SYNTHESIZABLE_TEXT" &&
            message.code !== "SYNTHESIS_RETRYING" &&
            message.code !== "INPUT_MARKUP_STRIPPED"
          )
            throw new TypeError(`Deepgram Flux warning: ${message.code}`);
          break;
        default:
          throw new TypeError("Deepgram returned an invalid Flux WebSocket event");
      }
    }
    signal.throwIfAborted();
    if (!closeSent)
      throw new TypeError("Deepgram WebSocket closed before input or pending synthesis completed");
  } finally {
    connection.close();
    lifetime.abort();
  }
}
