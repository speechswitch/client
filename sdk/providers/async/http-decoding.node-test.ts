import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesizeWithTimestamps } from "./index.ts";

test("Async timestamp JSON decodes split UTF-8 with one leading BOM", async () => {
  const bytes = new TextEncoder().encode(
    "\uFEFF" +
      JSON.stringify({
        audio_base64: "AQ==",
        alignment: {
          words: ["héllo"],
          word_start_times_milliseconds: [0],
          word_end_times_milliseconds: [10],
        },
      }),
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  assert.deepEqual(
    await Array.fromAsync(
      synthesizeWithTimestamps(
        {
          model: "flash_v1.5",
          voice: "custom",
          text: "héllo",
          timestampGranularity: "word",
          output: { container: "raw", codec: "pcm", sampleRateHz: 24000 },
        },
        { auth: { async: { apiKey: "test-key" } }, fetch: async () => new Response(body) },
      ),
    ),
    [
      {
        correlation: "chunk",
        audio: Uint8Array.of(1),
        timestamps: [{ kind: "word", value: "héllo", startTimeMs: 0, endTimeMs: 10 }],
      },
    ],
  );
  assert.equal(body.locked, false);
});
