export async function* textChunks(text: string | AsyncIterable<string>): AsyncIterableIterator<string> {
  if (typeof text === "string") {
    yield text;
    return;
  }
  yield* text;
}
