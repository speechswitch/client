export async function* jsonLines(stream: ReadableStream<Uint8Array>): AsyncIterableIterator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "").trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as unknown;
      newline = buffer.indexOf("\n");
    }
  }
  const final = `${buffer}${decoder.decode()}`.trim();
  if (final) yield JSON.parse(final) as unknown;
}
