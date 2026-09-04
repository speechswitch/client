import { expect, test } from "bun:test";
import { jsonLines } from "./json-lines.ts";

test("parses fragmented newline-delimited JSON including an unterminated final value", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"one":'));
      controller.enqueue(new TextEncoder().encode('1}\r\n\n{"two":2}'));
      controller.close();
    },
  });
  expect(await Array.fromAsync(jsonLines(stream))).toEqual([{ one: 1 }, { two: 2 }]);
});
