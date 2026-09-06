import { expect, test } from "bun:test";
import { serverSentEvents } from "./sse.ts";

test("SSE event names retain the last field and reset at each dispatch", async () => {
  const response = new Response("event: ignored\nevent: speech.audio.delta\ndata: first\n\ndata: second\n\nevent:\ndata: third\n\n");
  expect(await Array.fromAsync(serverSentEvents(response.body!, true))).toEqual([
    { event: "speech.audio.delta", data: "first" }, { event: "message", data: "second" }, { event: "message", data: "third" },
  ]);
});

test("SSE accepts an abortable byte iterator and forwards consumer cleanup", async () => {
  let returned = false;
  async function* bytes() {
    try { yield new TextEncoder().encode("data: first\n\ndata: second\n\n"); }
    finally { returned = true; }
  }
  const events = serverSentEvents(bytes());
  expect(await events.next()).toEqual({ done: false, value: "first" });
  await events.return!(); expect(returned).toBe(true);
});

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
