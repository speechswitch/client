import type { TtsInput, TtsRequest } from "../../../schemas/providers/deepgram/index.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { decodeFrame, openSession } from "./session.ts";

type Message =
  | Uint8Array
  | { type: "Connected" | "SessionMetadata" }
  | {
      type: "SpeechStarted" | "SpeechMetadata" | "SpeechInterrupted" | "Flushed";
      speech_id: string;
    }
  | { type: "Warning"; code: string };

function decode(data: unknown): Message {
  const message = decodeFrame(data);
  if (message instanceof Uint8Array) return message;
  if (message.type === "Warning" || message.type === "Error") {
    if (typeof message.code !== "string" || typeof message.description !== "string")
      throw new TypeError("Deepgram returned an invalid error event");
    if (message.type === "Warning") return { type: "Warning", code: message.code };
    throw new TypeError(`Deepgram Error ${message.code}: ${message.description}`);
  }
  if (message.type === "Connected" && typeof message.request_id === "string")
    return { type: "Connected" };
  if (message.type === "SessionMetadata") return { type: "SessionMetadata" };
  if (
    (message.type === "SpeechStarted" ||
      message.type === "SpeechMetadata" ||
      message.type === "Flushed") &&
    typeof message.speech_id === "string"
  ) {
    return { type: message.type, speech_id: message.speech_id };
  }
  if (
    message.type === "SpeechInterrupted" &&
    message.metadata &&
    typeof message.metadata === "object" &&
    "speech_id" in message.metadata &&
    typeof message.metadata.speech_id === "string"
  ) {
    return { type: "SpeechInterrupted", speech_id: message.metadata.speech_id };
  }
  throw new TypeError("Deepgram returned an invalid Flux WebSocket event");
}

export async function* streamFlux(
  request: TtsRequest,
  text: AsyncIterable<TtsInput>,
  socket: WebSocketLike,
  signal: AbortSignal,
): AsyncIterableIterator<Uint8Array> {
  const session = await openSession({ request, text, socket, signal, decode });
  let buffer: "empty" | "text" = "empty";
  let interruptions = 0;
  let speechId: string | undefined;
  const flush = () => {
    if (buffer === "text") {
      buffer = "empty";
      session.send({ type: "Flush" });
    }
  };
  for await (const message of session.receive({
    onInput(value) {
      if (typeof value === "string") {
        if (value) {
          buffer = "text";
          session.send({ type: "Speak", text: value });
        }
      } else if (value.command === "clear") {
        interruptions++;
        session.send({ type: "Interrupt" });
      } else flush();
    },
    onInputEnd() {
      flush();
      session.send({ type: "Close" });
    },
  })) {
    if (message instanceof Uint8Array) {
      if (!speechId) throw new TypeError("Deepgram Flux audio arrived outside a turn");
      if (interruptions === 0) yield message;
      continue;
    }
    switch (message.type) {
      case "Connected":
      case "SessionMetadata":
        break;
      case "SpeechStarted":
        if (speechId) throw new TypeError("Overlapping Deepgram Flux turns");
        speechId = message.speech_id;
        break;
      case "Flushed":
        if (message.speech_id !== speechId)
          throw new TypeError("Unexpected Deepgram Flux flush acknowledgement");
        break;
      case "SpeechMetadata":
      case "SpeechInterrupted":
        if (!speechId || message.speech_id !== speechId)
          throw new TypeError("Unexpected Deepgram Flux turn completion");
        if (message.type === "SpeechInterrupted") {
          if (interruptions === 0) throw new TypeError("Unexpected Deepgram Flux interruption");
          interruptions--;
        }
        speechId = undefined;
        break;
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
    }
  }
}
