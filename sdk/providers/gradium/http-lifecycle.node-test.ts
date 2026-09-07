import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { synthesize, GradiumError } from "./index.ts";

const request = { text: "Hello", voice: "saved", output: { format: "pcm" } } as const;
const auth = { gradium: { apiKey: "test-key" } };

for (const timestampGranularity of [undefined, "segment"] as const) test(`Gradium cancels and releases a stalled HTTP error with timestamps ${timestampGranularity ?? "off"}`, { timeout: 2000 }, async () => {
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const canceled: unknown[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) { bodyController = controller; },
    pull() { started(); },
    cancel(reason) { canceled.push(reason); },
  }, { highWaterMark: 0 });
  const controller = new AbortController(); const reason = new Error("stop response");
  const pending = synthesize({ ...request, timestampGranularity }, { auth, signal: controller.signal, fetch: async () => new Response(body, { status: 403 }) }).next();
  try {
    await reading; controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    await setImmediate();
    assert.deepEqual(canceled, [reason]);
    assert.equal(body.locked, false);
  } finally {
    controller.abort();
    if (!canceled.length) bodyController.close();
    await pending.catch(() => {});
  }
});

test("Gradium fragmented HTTP errors preserve Unicode, status and safe native codes", async () => {
  for (const code of ["1008", "9007199254740992"]) {
    const bytes = new TextEncoder().encode(`\uFEFFerror from server ${code}: refusé\uFEFF`);
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    await assert.rejects(synthesize(request, { auth, fetch: async (_url, init) => {
      assert.equal(init?.redirect, "error");
      return new Response(body, { status: 403 });
    } }).next(), new GradiumError("refusé\uFEFF", 403, code === "1008" ? 1008 : null));
    assert.equal(body.locked, false);
  }
});

test("Gradium HTTP error read failures preserve the cause and release the reader", async () => {
  const failure = new Error("broken response");
  const body = new ReadableStream<Uint8Array>({ pull() { throw failure; } }, { highWaterMark: 0 });
  await assert.rejects(synthesize(request, { auth, fetch: async () => new Response(body, { status: 403 }) }).next(), error => error === failure);
  assert.equal(body.locked, false);
});
