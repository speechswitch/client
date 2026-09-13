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

type State =
  | "idle"
  | "speaking"
  | "flushing"
  | "interrupting"
  | "interruptingFlushed"
  | "discarding";

export async function* streamFlux(
  request: TtsRequest,
  text: AsyncIterable<TtsInput>,
  socket: WebSocketLike,
  signal: AbortSignal,
): AsyncIterableIterator<Uint8Array> {
  const session = await openSession(request, text, socket, signal, decode);
  let state: State = "idle";
  // The server assigns this asynchronously, after the first Speak of each turn.
  let speechId: string | undefined;
  let inputDone = false;
  try {
    for (;;) {
      if (inputDone && state === "idle") {
        session.send({ type: "Close" });
        return;
      }
      const event = await session.next(
        state === "idle" || state === "speaking" ? "all" : state === "flushing" ? "clear" : "none",
      );
      if (event.kind === "input") {
        const result = event.value;
        const value = result.done ? undefined : result.value;
        if (typeof value === "string") {
          if (value) {
            session.send({ type: "Speak", text: value });
            state = "speaking";
          }
        } else if (value?.command === "clear") {
          if (state !== "idle") {
            session.send({ type: "Interrupt" });
            state = state === "flushing" ? "interruptingFlushed" : "interrupting";
          }
        } else {
          inputDone = !!result.done;
          if (state === "speaking") {
            session.send({ type: "Flush" });
            state = "flushing";
          }
        }
        continue;
      }
      const message = event.value;
      if (message instanceof Uint8Array) {
        if (!speechId) throw new TypeError("Deepgram Flux audio arrived outside a turn");
        if (state === "speaking" || state === "flushing") yield message;
        continue;
      }
      switch (message.type) {
        case "Connected":
          break;
        case "SpeechStarted":
          if (speechId || state === "idle") throw new TypeError("Overlapping Deepgram Flux turns");
          speechId = message.speech_id;
          break;
        case "Flushed":
          // Flushed is not completion: audio may still precede SpeechMetadata.
          if (
            message.speech_id !== speechId ||
            (state !== "flushing" && state !== "interruptingFlushed" && state !== "discarding")
          )
            throw new TypeError("Unexpected Deepgram Flux flush acknowledgement");
          break;
        case "SpeechMetadata":
        case "SpeechInterrupted":
          if (!speechId || message.speech_id !== speechId)
            throw new TypeError("Unexpected Deepgram Flux turn completion");
          if (state === "idle" || state === "speaking")
            throw new TypeError("Deepgram Flux completed an unfinished turn");
          if (
            message.type === "SpeechInterrupted" &&
            state !== "interrupting" &&
            state !== "interruptingFlushed"
          )
            throw new TypeError("Unexpected Deepgram Flux interruption");
          speechId = undefined;
          state = "idle";
          break;
        case "Warning":
          if (
            message.code === "NO_AUDIO_GENERATED" &&
            (state === "interrupting" || state === "interruptingFlushed")
          ) {
            // Interrupt was ignored; finish the turn while suppressing its audio.
            if (state === "interrupting") session.send({ type: "Flush" });
            state = "discarding";
          } else if (
            message.code !== "NO_SYNTHESIZABLE_TEXT" &&
            message.code !== "SYNTHESIS_RETRYING" &&
            message.code !== "INPUT_MARKUP_STRIPPED"
          ) {
            throw new TypeError(`Deepgram Flux warning: ${message.code}`);
          }
          break;
        case "SessionMetadata":
          throw new TypeError("Deepgram Flux session ended before input completed");
      }
    }
  } finally {
    session.close();
  }
}
