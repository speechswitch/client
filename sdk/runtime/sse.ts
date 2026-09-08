/** Decode SSE data fields across arbitrary UTF-8 and CR/LF network boundaries. */
export async function* serverSentEvents(body: ReadableStream<Uint8Array>): AsyncIterableIterator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  function* drain(eof: boolean): Generator<string> {
    for (;;) {
      const index = buffer.search(/[\r\n]/);
      if (index < 0 || (!eof && buffer[index] === "\r" && index === buffer.length - 1)) return;
      const line = buffer.slice(0, index);
      const width = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(index + width);
      if (line === "") {
        if (data.length) yield data.join("\n");
        data = [];
      } else {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        if (field === "data") {
          const value = colon < 0 ? "" : line.slice(colon + 1);
          data.push(value.startsWith(" ") ? value.slice(1) : value);
        }
      }
    }
  }
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    yield* drain(false);
  }
  buffer += decoder.decode();
  yield* drain(true);
  // SSE requires a blank line to dispatch; unfinished data at EOF is discarded.
}
