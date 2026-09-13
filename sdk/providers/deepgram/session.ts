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

/** One input lookahead lets clear interrupt a flush without buffering subsequent text. */
export async function openSession<Message>(
  request: TtsRequest,
  text: AsyncIterable<TtsInput>,
  socket: WebSocketLike,
  signal: AbortSignal,
  decode: (data: unknown) => Message,
) {
  const connection = await connectWebSocket({
    socket,
    signal,
    decode,
    encode: (message: { readonly type: string; readonly text?: string }) => JSON.stringify(message),
  });
  let source: AsyncIterator<TtsInput>;
  try {
    source = text[Symbol.asyncIterator]();
  } catch (error) {
    connection.close();
    throw error;
  }
  let inputDone = false;
  let stopped = false;
  const stopInput = () => {
    if (stopped || inputDone) return;
    stopped = true;
    try {
      void Promise.resolve(source.return?.()).catch(() => {});
    } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  const readInput = () =>
    Promise.resolve()
      .then(() => source.next())
      .then(
        (value) => ({ kind: "input" as const, value }),
        (error) => ({ kind: "error" as const, error }),
      );
  const readOutput = () =>
    connection.messages.next().then(
      (value) => ({ kind: "output" as const, value }),
      (error) => ({ kind: "error" as const, error }),
    );
  let pendingInput = readInput();
  let pendingOutput = readOutput();
  let held: IteratorResult<TtsInput> | undefined;
  let preferInput = true;
  return {
    send: connection.send,
    async next(input: "all" | "clear" | "none") {
      for (;;) {
        signal.throwIfAborted();
        const acceptsHeld =
          held &&
          (input === "all" ||
            (input === "clear" &&
              !held.done &&
              typeof held.value !== "string" &&
              held.value.command === "clear"));
        const availableInput = held
          ? acceptsHeld
            ? Promise.resolve({ kind: "input" as const, value: held })
            : undefined
          : inputDone
            ? undefined
            : pendingInput;
        const event = await Promise.race(
          !availableInput
            ? [pendingOutput]
            : preferInput
              ? [availableInput, pendingOutput]
              : [pendingOutput, availableInput],
        );
        preferInput = !preferInput;
        signal.throwIfAborted();
        if (event.kind === "error") throw event.error;
        if (event.kind === "output") {
          if (event.value.done)
            throw new TypeError(
              "Deepgram WebSocket closed before input or pending synthesis completed",
            );
          pendingOutput = readOutput();
          return { kind: "output" as const, value: event.value.value };
        }
        const result = event.value;
        if (!held && !result.done) validateInputItem(request, result.value);
        if (
          input !== "all" &&
          !(
            input === "clear" &&
            !result.done &&
            typeof result.value !== "string" &&
            result.value.command === "clear"
          )
        ) {
          held = result;
          continue;
        }
        held = undefined;
        inputDone = !!result.done;
        if (!inputDone) pendingInput = readInput();
        return { kind: "input" as const, value: result };
      }
    },
    close() {
      signal.removeEventListener("abort", stopInput);
      stopInput();
      connection.close();
    },
  };
}
