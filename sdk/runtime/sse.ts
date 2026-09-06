export interface SseMessage { readonly event: string; readonly data: string }
/** Decode SSE across arbitrary UTF-8 and CR/LF boundaries, optionally retaining event names. */
export function serverSentEvents(body: AsyncIterable<Uint8Array>): AsyncIterableIterator<string>;
export function serverSentEvents(body: AsyncIterable<Uint8Array>, includeEvent: true): AsyncIterableIterator<SseMessage>;
export async function* serverSentEvents(body: AsyncIterable<Uint8Array>, includeEvent = false): AsyncIterableIterator<string | SseMessage> {
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let event = "";
  function* drain(eof: boolean): Generator<string | SseMessage> {
    for (;;) {
      const index = buffer.search(/[\r\n]/);
      if (index < 0 || (!eof && buffer[index] === "\r" && index === buffer.length - 1)) return;
      const line = buffer.slice(0, index);
      const width = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(index + width);
      if (line === "") {
        if (data.length) yield includeEvent ? { event: event || "message", data: data.join("\n") } : data.join("\n");
        data = []; event = "";
      } else {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        if (field === "data" || field === "event") {
          const value = colon < 0 ? "" : line.slice(colon + 1);
          const text = value.startsWith(" ") ? value.slice(1) : value;
          if (field === "data") data.push(text); else event = text;
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
