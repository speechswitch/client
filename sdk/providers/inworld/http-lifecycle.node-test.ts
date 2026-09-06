import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { synthesize, InworldError } from "./index.ts";

const request = { model: "inworld-tts-2", voice: "custom-voice", text: "Hello", output: { format: "pcm" } } as const;
const auth = { inworld: { apiKey: "test-key" } };

for (const status of [200, 403]) test(`Inworld abort releases a stalled ${status} single-response body`, { timeout: 2000 }, async () => {
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const canceled: unknown[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) { bodyController = controller; },
    pull() { started(); },
    cancel(reason) { canceled.push(reason); },
  }, { highWaterMark: 0 });
  const controller = new AbortController();
  const reason = new Error("stop response");
  const pending = synthesize(request, { auth, httpMode: "single", signal: controller.signal,
    fetch: async () => new Response(body, { status }),
  }).next();
  try {
    await reading;
    controller.abort(reason);
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

test("Inworld single-response EOF releases the reader before yielding audio", async () => {
  const response = Response.json({ audioContent: "AQI=" });
  const result = synthesize(request, { auth, httpMode: "single", fetch: async () => response });
  try {
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(1, 2) });
    assert.equal(response.body!.locked, false);
    assert.deepEqual(await result.next(), { done: true, value: undefined });
  } finally { await result.return!(); }
});

test("Inworld fragmented HTTP errors retain status and code while releasing their reader", async () => {
  const bytes = new TextEncoder().encode('\uFEFF{"code":7,"message":"refusé"}');
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  await assert.rejects(synthesize(request, { auth, fetch: async () => new Response(body, { status: 403 }) }).next(),
    new InworldError("refusé", 403, 7));
  assert.equal(body.locked, false);
});

test("Inworld body read failures release the reader and preserve the original error", async () => {
  const failure = new Error("broken response");
  const body = new ReadableStream<Uint8Array>({ pull() { throw failure; } }, { highWaterMark: 0 });
  await assert.rejects(synthesize(request, { auth, httpMode: "single", fetch: async () => new Response(body) }).next(), error => error === failure);
  assert.equal(body.locked, false);
});

for (const httpMode of ["stream", "single"] as const) test(`Inworld ${httpMode} requests disable implicit redirects`, async () => {
  let redirect: RequestRedirect | undefined;
  const audio = { audioContent: "AQI=" };
  const result = await Array.fromAsync(synthesize(request, { auth, httpMode, fetch: async (_url, init) => {
    redirect = init?.redirect;
    return Response.json(httpMode === "stream" ? { result: audio } : audio);
  } }));
  assert.deepEqual(result, [Uint8Array.of(1, 2)]);
  assert.equal(redirect, "error");
});
