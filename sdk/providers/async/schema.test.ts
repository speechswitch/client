import assert from "node:assert/strict";
import { test } from "bun:test";
import { validateRequest } from "../../generated/validators/async.ts";

const request = { voice: "custom", model: "flash_v1.5", text: "Hello" } as const;
test.each(["pcm", "wav", "mp3", "mulaw"] as const)("Async schema requires integer %s sample rates", format => {
  assert.equal(typeof validateRequest({ ...request, output: { format, sampleRateHz: 24000 } }), "function");
  assert.throws(() => validateRequest({ ...request, output: { format, sampleRateHz: 24000.5 } }), { name: "TypeError", message: "Invalid async TTS request" });
});
test("Async schema requires integer MP3 bit rates", () => {
  assert.equal(typeof validateRequest({ ...request, output: { format: "mp3", sampleRateHz: 24000, bitRateBps: 64000 } }), "function");
  assert.throws(() => validateRequest({ ...request, output: { format: "mp3", sampleRateHz: 24000, bitRateBps: 64000.5 } }), { name: "TypeError", message: "Invalid async TTS request" });
});
