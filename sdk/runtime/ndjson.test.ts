import { expect, test } from "bun:test";
import { newlineDelimitedJson } from "./ndjson.ts";

test("NDJSON handles split UTF-8, CRLF, blanks, and a final unterminated record", async () => {
  const bytes = new TextEncoder().encode('\n{"text":"😀é"}\r\n\n{"last":true}');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  expect(await Array.fromAsync(newlineDelimitedJson(body))).toEqual([{ text: "😀é" }, { last: true }]);
});

test("NDJSON cancels on early exit and rejects malformed final records and UTF-8", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"first":1}\n')); }, cancel() { cancelled = true; } });
  const stream = newlineDelimitedJson(body); await stream.next(); await stream.return?.(); expect(cancelled).toBe(true);
  await expect(Array.fromAsync(newlineDelimitedJson(new Response('{"broken":').body!))).rejects.toThrow();
  await expect(Array.fromAsync(newlineDelimitedJson(new Response(Uint8Array.of(0xc3)).body!))).rejects.toThrow();
});
