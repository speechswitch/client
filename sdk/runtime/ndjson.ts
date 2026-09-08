/** Parse newline-delimited JSON without buffering the response or losing split UTF-8. */
export async function* newlineDelimitedJson(body: AsyncIterable<Uint8Array>): AsyncIterableIterator<unknown> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  for await (const bytes of body) {
    pending += decoder.decode(bytes, { stream: true });
    let end: number;
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (line.trim()) yield JSON.parse(line);
    }
  }
  pending += decoder.decode();
  if (pending.trim()) yield JSON.parse(pending);
}
