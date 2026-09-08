import { expect, test } from "bun:test";
import { serverSentEvents } from "./sse.ts";

test("SSE preserves UTF-8, multiline data, empty fields, and split CRLF", async () => {
  const bytes = new TextEncoder().encode("\uFEFF: keepalive\r\nevent: audio\r\ndata: hé\r\ndata: second\r\n\r\ndata\r\rdata: last\n\ndata: incomplete");
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  expect(await Array.fromAsync(serverSentEvents(body))).toEqual(["hé\nsecond", "", "last"]);
});

test("SSE dispatches the final blank CR line and cancels on consumer exit", async () => {
  const complete = new Response("data: final\r\r");
  expect(await Array.fromAsync(serverSentEvents(complete.body!))).toEqual(["final"]);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("data: first\n\ndata: second\n\n")); },
    cancel() { cancelled = true; },
  });
  const events = serverSentEvents(body);
  expect((await events.next()).value).toBe("first");
  await events.return!();
  expect(cancelled).toBe(true);
});
