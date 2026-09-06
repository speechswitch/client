import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SseMessage } from "../../schemas/transport.ts";
import { serverSentEvents } from "./sse.ts";

const fixtures: { name: string; text?: string; hex?: string; events: SseMessage[]; error?: string }[] = JSON.parse(
  readFileSync(new URL("../../sdks/fixtures/sse.json", import.meta.url), "utf8"),
);
for (const fixture of fixtures.filter(fixture => !fixture.error)) {
  test(`native SSE framing: ${fixture.name}`, async () => {
    const bytes = fixture.hex === undefined ? new TextEncoder().encode(fixture.text) : Buffer.from(fixture.hex, "hex");
    for (let split = 0; split <= bytes.length; split++) {
      async function* chunks() { yield bytes.subarray(0, split); yield new Uint8Array(); yield bytes.subarray(split); }
      assert.deepEqual(await Array.fromAsync(serverSentEvents(chunks(), true)), fixture.events);
    }
  });
}

test("dispatches a blank CR without pulling another network chunk", async () => {
  let closed = false;
  async function* chunks() {
    try {
      yield new TextEncoder().encode("data: first\r\r");
      throw new Error("Decoder read beyond a completed CR event");
    } finally { closed = true; }
  }
  const events = serverSentEvents(chunks(), true);
  try {
    assert.deepEqual(await events.next(), { done: false, value: { event: "message", data: "first" } });
  } finally { await events.return!(); }
  assert.equal(closed, true);
});
