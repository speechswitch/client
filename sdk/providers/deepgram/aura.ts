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
  const session = await openSession(request, text, socket, signal, decode);
  let state: "idle" | "speaking" | "flushing" | "clearing" = "idle";
  let inputDone = false;
  try {
    for (;;) {
      if (inputDone && state === "idle") {
        session.send({ type: "Close" });
        return;
      }
      const event = await session.next(
        state === "clearing" ? "none" : state === "flushing" ? "clear" : "all",
      );
      if (event.kind === "output") {
        const message = event.value;
        if (message instanceof Uint8Array) {
          if (state !== "clearing") yield message;
        } else if (message.type === "Cleared") {
          if (state !== "clearing")
            throw new TypeError("Unexpected Deepgram Cleared acknowledgement");
          state = "idle";
        } else if (message.type === "Flushed" && state !== "clearing") {
          if (state !== "flushing")
            throw new TypeError("Unexpected Deepgram Flushed acknowledgement");
          state = "idle";
        }
        continue;
      }
      const result = event.value;
      const value = result.done ? undefined : result.value;
      if (typeof value === "string") {
        const chunk = pronunciations ? pronunciations.text(value) : value;
        if (chunk) {
          session.send({ type: "Speak", text: chunk });
          state = "speaking";
        }
      } else if (value?.command === "clear") {
        pronunciations?.reset();
        session.send({ type: "Clear" });
        state = "clearing";
      } else {
        inputDone = !!result.done;
        const tail = pronunciations?.text("", true);
        if (tail) {
          session.send({ type: "Speak", text: tail });
          state = "speaking";
        }
        if (state === "speaking") {
          session.send({ type: "Flush" });
          state = "flushing";
        }
      }
    }
  } finally {
    session.close();
  }
}
