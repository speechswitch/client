import assert from "node:assert/strict";
import { test } from "node:test";
import { synthesize } from "./index.ts";

const request = {
  model: "aura-1",
  voice: "asteria",
  language: "en",
  text: "Hello",
  output: { container: "raw", codec: "pcm", sampleRateHz: 24000 },
} as const;
const auth = { deepgram: { apiKey: "test-key" } };

test("HTTP abort before headers settles without cooperation and cancels a late body", async () => {
  const controller = new AbortController();
  const gate = Promise.withResolvers<Response>();
  const reason = new Error("stop before headers");
  let canceled = 0;
  const stream = synthesize(request, {
    auth,
    signal: controller.signal,
    fetch: () => gate.promise,
  });
  const pending = stream.next().then(
    () => "resolved",
    (error) => error,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    controller.abort(reason);
    assert.equal(
      await Promise.race([
        pending,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve("still pending"), 100);
        }),
      ]),
      reason,
    );
  } finally {
    clearTimeout(timer);
    gate.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            canceled++;
          },
        }),
      ),
    );
  }
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(canceled, 1);
});

test("HTTP failure cancels its body without reading or exposing server content", async () => {
  let reads = 0;
  let canceled = 0;
  await assert.rejects(
    synthesize(request, {
      auth,
      fetch: async () =>
        new Response(
          new ReadableStream(
            {
              pull() {
                reads++;
                throw new Error("Error body must not be read");
              },
              cancel() {
                canceled++;
              },
            },
            { highWaterMark: 0 },
          ),
          { status: 401 },
        ),
    }).next(),
    { name: "TypeError", message: "Deepgram returned HTTP 401" },
  );
  assert.deepEqual([reads, canceled], [0, 1]);
});

test("HTTP abort after a chunk prevents successful iterator completion", async () => {
  const controller = new AbortController();
  const reason = new Error("stop after audio");
  const stream = synthesize(request, {
    auth,
    signal: controller.signal,
    fetch: async () => new Response(Uint8Array.of(1)),
  });
  assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(1) });
  controller.abort(reason);
  await assert.rejects(stream.next(), (error) => error === reason);
});

test("HTTP abort cancels a stalled injected body read", async () => {
  const controller = new AbortController();
  const reason = new Error("stop reading");
  let canceled = 0;
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = synthesize(request, {
    auth,
    signal: controller.signal,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(value) {
            bodyController = value;
            value.enqueue(Uint8Array.of(1));
          },
          cancel() {
            canceled++;
          },
        }),
      ),
  });
  assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(1) });
  const pending = stream.next().then(
    () => "resolved",
    (error) => error,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    controller.abort(reason);
    assert.equal(
      await Promise.race([
        pending,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve("still pending"), 100);
        }),
      ]),
      reason,
    );
    assert.equal(canceled, 1);
  } finally {
    clearTimeout(timer);
    if (!canceled) bodyController.close();
    await pending;
  }
});

test("HTTP early return aborts the request lifetime and releases the body", async () => {
  let signal: AbortSignal | null | undefined;
  let canceled = 0;
  const stream = synthesize(request, {
    auth,
    fetch: async (_url, init) => {
      signal = init?.signal;
      assert.equal(init?.redirect, "error");
      return new Response(
        new ReadableStream({
          start(value) {
            value.enqueue(Uint8Array.of(1));
          },
          cancel() {
            canceled++;
          },
        }),
      );
    },
  });
  assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(1) });
  assert.equal(signal?.aborted, false);
  await stream.return?.();
  assert.equal(signal?.aborted, true);
  assert.equal(canceled, 1);
});

test("HTTP non-audio success and empty audio are not successful synthesis", async () => {
  for (const [response, message] of [
    [
      new Response("{}", { headers: { "content-type": "application/json" } }),
      "Deepgram returned an unexpected audio content type",
    ],
    [new Response(new Uint8Array()), "Deepgram returned no audio bytes"],
  ] as const)
    await assert.rejects(
      Array.fromAsync(synthesize(request, { auth, fetch: async () => response })),
      { name: "TypeError", message },
    );
});
