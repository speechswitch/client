import type { TtsInput, TtsRequest } from "../../../schemas/providers/deepgram/index.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";
import { validateInputItem } from "../../generated/validators/deepgram.ts";
import type { pronunciation } from "./pronunciation.ts";

type Message =
  | { type: "Metadata" }
  | { type: "Flushed" | "Cleared" }
  | { type: "Warning" | "Error"; code: string; description: string };

export async function* streamAura(
  request: TtsRequest,
  text: AsyncIterable<TtsInput>,
  socket: WebSocketLike,
  signal: AbortSignal,
  pronunciations: ReturnType<typeof pronunciation> | undefined,
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
  let source: AsyncIterator<TtsInput> | undefined;
  let input: "reading" | "finished" | "stopped" = "reading";
  let closeSent = false;
  const stopInput = () => {
    if (input !== "reading") return;
    input = "stopped";
    try {
      // Do not wait for a stalled producer to finish returning.
      void Promise.resolve(source?.return?.()).catch(() => {});
    } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });

  // Aura Close stops immediately, so drain control acknowledgements before sending it.
  const pending: ("Flushed" | "Cleared")[] = [];
  let head = 0;
  let clears = 0;
  let buffer: "empty" | "text" = "empty";
  const finish = () => {
    if (input === "finished" && head === pending.length) {
      closeSent = true;
      connection.send({ type: "Close" });
    }
  };
  const flush = () => {
    const tail = pronunciations?.text("", true);
    if (tail) {
      buffer = "text";
      connection.send({ type: "Speak", text: tail });
    }
    if (buffer === "text") {
      buffer = "empty";
      pending.push("Flushed");
      connection.send({ type: "Flush" });
    }
  };
  async function sendInput() {
    signal.throwIfAborted();
    source = text[Symbol.asyncIterator]();
    while (input === "reading") {
      const result = await source.next();
      signal.throwIfAborted();
      if (result.done) {
        input = "finished";
        break;
      }
      const value = result.value;
      validateInputItem(request, value);
      if (typeof value === "string") {
        const chunk = pronunciations ? pronunciations.text(value) : value;
        if (chunk) {
          buffer = "text";
          connection.send({ type: "Speak", text: chunk });
        }
      } else if (value.command === "clear") {
        pronunciations?.reset();
        buffer = "empty";
        clears++;
        pending.push("Cleared");
        connection.send({ type: "Clear" });
      } else flush();
    }
    flush();
    finish();
  }
  void sendInput().catch((error: unknown) => lifetime.abort(error));
  try {
    for await (const message of connection.messages) {
      if (message instanceof Uint8Array) {
        if (clears === 0) yield message;
      } else if (message.type === "Warning" || message.type === "Error") {
        throw new TypeError(`Deepgram ${message.type} ${message.code}: ${message.description}`);
      } else if (message.type === "Flushed" || message.type === "Cleared") {
        if (message.type === "Cleared") {
          // Clear can cancel outstanding flushes, which then have no acknowledgement.
          while (pending[head] === "Flushed") head++;
          clears--;
        }
        if (pending[head] !== message.type)
          throw new TypeError(`Unexpected Deepgram ${message.type} acknowledgement`);
        head++;
        if (head === pending.length) {
          pending.length = 0;
          head = 0;
        } else if (head >= 1024 && head * 2 >= pending.length) {
          pending.splice(0, head);
          head = 0;
        }
        finish();
      } else if (message.type !== "Metadata") {
        throw new TypeError("Deepgram returned an invalid WebSocket event");
      }
    }
    signal.throwIfAborted();
    if (!closeSent)
      throw new TypeError("Deepgram WebSocket closed before input or pending synthesis completed");
  } finally {
    signal.removeEventListener("abort", stopInput);
    stopInput();
    connection.close();
    lifetime.abort();
  }
}
