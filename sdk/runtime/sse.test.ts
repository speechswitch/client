import { expect, test } from "bun:test";
import { serverSentEvents } from "./sse.ts";

test("parses fragmented CRLF server-sent event data", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("event: message\r\ndata: {\"a\":"));
      controller.enqueue(new TextEncoder().encode("1}\r\n\r\ndata: two\ndata: lines\n\n"));
      controller.close();
    },
  });
  expect(await Array.fromAsync(serverSentEvents(body))).toEqual(["{\"a\":1}", "two\nlines"]);
});
