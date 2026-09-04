export async function* serverSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterableIterator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const lines = async function* () {
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer.replace(/\r$/, "");
    yield "";
  };
  for await (const line of lines()) {
    if (line === "") {
      if (data.length) yield data.join("\n");
      data = [];
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
}
