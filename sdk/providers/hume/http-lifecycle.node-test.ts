import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { synthesize, HumeError } from "./index.ts";

const request = { model: "octave-2", text: "Hello", voice: "saved", output: { format: "pcm" } } as const;
const auth = { hume: { apiKey: "test-key" } };

for (const includeMetadata of [false, true]) test(`Hume cancels and releases a stalled HTTP error in ${includeMetadata ? "JSON" : "file"} mode`, { timeout: 2000 }, async () => {
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
  const pending = synthesize(request, { auth, includeMetadata, signal: controller.signal, fetch: async () => new Response(body, { status: 403 }) }).next();
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

test("Hume fragmented HTTP errors preserve Unicode, status and native code and release the reader", async () => {
  const bytes = new TextEncoder().encode('\uFEFF{"code":"denied","message":"refusé\uFEFF"}');
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  await assert.rejects(synthesize(request, { auth, fetch: async () => new Response(body, { status: 403 }) }).next(), new HumeError("refusé\uFEFF", 403, "denied"));
  assert.equal(body.locked, false);
});

test("Hume HTTP error read failures preserve the cause and release the reader", async () => {
  const failure = new Error("broken response");
  const body = new ReadableStream<Uint8Array>({ pull() { throw failure; } }, { highWaterMark: 0 });
  await assert.rejects(synthesize(request, { auth, fetch: async () => new Response(body, { status: 403 }) }).next(), error => error === failure);
  assert.equal(body.locked, false);
});
