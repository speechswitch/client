import type { TtsInput, TtsRequest } from "../../../schemas/providers/deepgram/index.ts";
import type { WebSocketLike } from "../../websocket.ts";
import type { pronunciation } from "./pronunciation.ts";
import { decodeFrame, openSession } from "./session.ts";

type Message =
  | Uint8Array
  | { type: "Metadata" }
  | { type: "Flushed" | "Cleared"; sequence_id: number };
function decode(data: unknown): Message {
  const message = decodeFrame(data);
  if (message instanceof Uint8Array) return message;
  if (message.type === "Warning" || message.type === "Error") {
    // A rejected Flush may never be acknowledged.
    if (typeof message.code !== "string" || typeof message.description !== "string")
      throw new TypeError("Deepgram returned an invalid error event");
    throw new TypeError(`Deepgram ${message.type} ${message.code}: ${message.description}`);
  }
  if (message.type === "Metadata" && typeof message.request_id === "string")
    return { type: "Metadata" };
  if (
    (message.type === "Flushed" || message.type === "Cleared") &&
    typeof message.sequence_id === "number" &&
    Number.isSafeInteger(message.sequence_id) &&
    message.sequence_id >= 0
  ) {
    return { type: message.type, sequence_id: message.sequence_id };
  }
  throw new TypeError("Deepgram returned an invalid WebSocket event");
}

export async function* streamAura(
  request: TtsRequest,
  text: AsyncIterable<TtsInput>,
  socket: WebSocketLike,
  signal: AbortSignal,
  pronunciations: ReturnType<typeof pronunciation> | undefined,
): AsyncIterableIterator<Uint8Array> {
  const session = await openSession({ request, text, socket, signal, decode });
  // Aura Close stops immediately, so drain control acknowledgements before sending it.
  const pending: ("Flushed" | "Cleared")[] = [];
  let head = 0;
  let clears = 0;
  let buffer: "empty" | "text" = "empty";
  let input: "reading" | "finished" = "reading";
  const finish = () => {
    if (input === "finished" && head === pending.length) session.send({ type: "Close" });
  };
  const flush = () => {
    const tail = pronunciations?.text("", true);
    if (tail) {
      buffer = "text";
      session.send({ type: "Speak", text: tail });
    }
    if (buffer === "text") {
      buffer = "empty";
      pending.push("Flushed");
      session.send({ type: "Flush" });
    }
  };
  for await (const message of session.receive({
    onInput(value) {
      if (typeof value === "string") {
        const chunk = pronunciations ? pronunciations.text(value) : value;
        if (chunk) {
          buffer = "text";
          session.send({ type: "Speak", text: chunk });
        }
      } else if (value.command === "clear") {
        pronunciations?.reset();
        buffer = "empty";
        clears++;
        pending.push("Cleared");
        session.send({ type: "Clear" });
      } else flush();
    },
    onInputEnd() {
      flush();
      input = "finished";
      finish();
    },
  })) {
    if (message instanceof Uint8Array) {
      if (clears === 0) yield message;
    } else if (message.type !== "Metadata") {
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
    }
  }
}
