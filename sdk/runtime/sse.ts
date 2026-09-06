import type { SseMessage } from "../../schemas/transport.ts";
export type { SseMessage } from "../../schemas/transport.ts";
/** Decode SSE across arbitrary UTF-8 and CR/LF boundaries, optionally retaining event names. */
export function serverSentEvents(body: AsyncIterable<Uint8Array>): AsyncIterableIterator<string>;
export function serverSentEvents(body: AsyncIterable<Uint8Array>, includeEvent: true): AsyncIterableIterator<SseMessage>;
export async function* serverSentEvents(body: AsyncIterable<Uint8Array>, includeEvent = false): AsyncIterableIterator<string | SseMessage> {
  // Handle the single leading BOM ourselves: streaming decoder BOM state differs
  // across runtimes when empty chunks or split BOM bytes are supplied.
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let first = true;
  let skipLf = false;
  let buffer = "";
  let data: string[] = [];
  let event = "";
  function* drain(): Generator<string | SseMessage> {
    for (;;) {
      if (!buffer.length) return;
      if (first) { first = false; if (buffer.startsWith("\uFEFF")) buffer = buffer.slice(1); }
      if (skipLf) { skipLf = false; if (buffer.startsWith("\n")) buffer = buffer.slice(1); }
      const index = buffer.search(/[\r\n]/);
      if (index < 0) return;
      const line = buffer.slice(0, index);
      skipLf = buffer[index] === "\r";
      buffer = buffer.slice(index + 1);
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
    yield* drain();
  }
  buffer += decoder.decode();
  yield* drain();
  // SSE requires a blank line to dispatch; unfinished data at EOF is discarded.
}
