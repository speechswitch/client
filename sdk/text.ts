import type { StreamingText } from "../schemas/tts.ts";

export async function* textChunks(text: StreamingText): AsyncIterableIterator<string> {
  if (typeof text === "string") {
    yield text;
    return;
  }
  yield* text;
}
