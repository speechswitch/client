import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRequest } from "../../generated/validators/async.ts";

const request = { voice: "custom", model: "flash_v1.5", text: "Hello" } as const;
for (const output of [
  { container: "raw", codec: "pcm" },
  { container: "wav", codec: "pcm" },
  { codec: "mp3" },
  { container: "raw", codec: "mulaw" },
] as const)
  test(`Async schema requires integer ${output.codec}/${output.container ?? "native"} sample rates`, () => {
    assert.equal(
      typeof validateRequest({ ...request, output: { ...output, sampleRateHz: 24000 } }),
      "undefined",
    );
    assert.throws(
      () => validateRequest({ ...request, output: { ...output, sampleRateHz: 24000.5 } }),
      TypeError,
    );
  });
test("Async schema requires integer MP3 bit rates", () => {
  assert.equal(
    typeof validateRequest({
      ...request,
      output: { codec: "mp3", sampleRateHz: 24000, bitRateBps: 64000 },
    }),
    "undefined",
  );
  assert.throws(
    () =>
      validateRequest({
        ...request,
        output: { codec: "mp3", sampleRateHz: 24000, bitRateBps: 64000.5 },
      }),
    TypeError,
  );
});

test("Async output unions separate containers, codecs, and PCM sample representations", () => {
  for (const output of [
    { container: "mp3", codec: "mulaw", sampleRateHz: 24000 },
    { container: "wav", codec: "mulaw", sampleRateHz: 24000 },
    { codec: "mp3", sampleFormat: "float32", sampleRateHz: 24000 },
    { container: "raw", codec: "mulaw", sampleFormat: "int16", sampleRateHz: 24000 },
  ])
    assert.throws(() => validateRequest({ ...request, output }), TypeError);
});
