import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { synthesize } from "./index.ts";

const request = { voice: "custom", model: "flash_v1.5", text: "Hello", output: { format: "pcm", sampleRateHz: 24000 } } as const;
const auth = { async: { apiKey: "test-key" } };

test("Async abort interrupts stalled headers and reclaims a late response", { timeout: 2000 }, async () => {
  const controller = new AbortController(); const reason = new Error("stop headers");
  let deliver!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { deliver = resolve; });
  const pending = synthesize(request, { auth, signal: controller.signal, fetch: () => response }).next();
  let canceled = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    controller.abort(reason);
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("headers remained pending")), 100);
    })]), error => error === reason);
  } finally {
    clearTimeout(timeout);
    deliver(new Response(new ReadableStream({ start(value) { value.enqueue(Uint8Array.of(1)); }, cancel() { canceled++; } })));
    await pending.catch(() => {});
  }
  await setImmediate(); assert.equal(canceled, 1);
});

for (const mode of ["stream", "wav", "timestamps", "error"] as const) test(`Async cancels stalled ${mode} body reads independently of fetch`, { timeout: 2000 }, async () => {
  const controller = new AbortController(); const reason = new Error("stop body");
  let started!: () => void; const reading = new Promise<void>(resolve => { started = resolve; });
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const canceled: unknown[] = [];
  const body = new ReadableStream<Uint8Array>({ start(value) { bodyController = value; }, pull() { started(); }, cancel(reason) { canceled.push(reason); } }, { highWaterMark: 0 });
  const input = mode === "timestamps" ? { ...request, timestampGranularity: "word" as const }
    : mode === "wav" ? { ...request, output: { format: "wav" as const, sampleRateHz: 24000 } } : request;
  const pending = synthesize(input, { auth, signal: controller.signal, fetch: async () => new Response(body, { status: mode === "error" ? 403 : 200 }) }).next();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await reading; controller.abort(reason);
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("body remained pending")), 100);
    })]), error => error === reason);
    await setImmediate();
    assert.deepEqual(canceled, [reason]); assert.equal(body.locked, false);
  } finally {
    clearTimeout(timeout); controller.abort();
    if (!canceled.length) bodyController.close();
    await pending.catch(() => {});
  }
});

test("Async consumer return aborts its request lifetime without waiting for body cancellation", { timeout: 2000 }, async () => {
  let signal: AbortSignal | null | undefined; let canceled = 0; let finish!: () => void;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { canceled++; return new Promise<void>(resolve => { finish = resolve; }); } });
  const stream = synthesize(request, { auth, fetch: async (_url, init) => { signal = init?.signal; return new Response(body); } });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(1) });
    assert.deepEqual(await Promise.race([stream.return!(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("return remained pending")), 100);
    })]), { done: true, value: undefined });
    assert.equal(signal?.aborted, true); assert.equal(canceled, 1); assert.equal(body.locked, false);
  } finally { clearTimeout(timeout); finish?.(); await stream.return!(); }
});

test("Async preserves proxy path and query and explicitly rejects redirects", async () => {
  let url: string | undefined; let redirect: RequestRedirect | undefined;
  await Array.fromAsync(synthesize(request, { auth, baseUrl: "https://proxy.invalid/root/?tenant=one", fetch: async (value, init) => {
    url = String(value); redirect = init?.redirect; return new Response(Uint8Array.of(1));
  } }));
  assert.equal(url, "https://proxy.invalid/root/text_to_speech/streaming?tenant=one");
  assert.equal(redirect, "error");
});
