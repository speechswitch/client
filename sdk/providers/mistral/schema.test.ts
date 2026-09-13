import { expect, expectTypeOf, test } from "bun:test";
import assert from "node:assert/strict";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest } from "./index.ts";
import { validateRequest } from "../../generated/validators/mistral.ts";

test("Mistral owns a plain request and independently supports existing voices and reference bytes", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const values = [
    { text: "Hi" }, { text: "Hi", voice: "saved-custom-voice" }, { text: "Hi", referenceAudio: Uint8Array.of(1, 2) },
    { text: "Hi", voice: "saved", referenceAudio: Uint8Array.of(1), metadata: { trace: { count: 0, enabled: false, labels: ["one", null] } }, promptCacheKey: "conversation-1" },
    { text: "Hi", output: { format: "pcm", sampleRateHz: 24000, sampleEncoding: "float_32", byteOrder: "little_endian", channelCount: 1 } },
  ] satisfies readonly TtsRequest[];
  for (const value of values) expect(typeof validateRequest(value)).toBe("function");
});
test("Mistral metadata diagnostics retain every invalid key and unrelated request error", () => {
  assert.throws(() => validateRequest({ text: false, metadata: { missing: undefined, nonfinite: NaN, valid: [null, false, 0] } }), {
    name: "TypeError", message: [
      "Invalid mistral TTS request:",
      'request["metadata"]["missing"]: expected JSON value',
      'request["metadata"]["nonfinite"]: expected JSON value',
      'request["text"]: expected string',
    ].join("\n"),
  });
});
test.each([
  { text: (async function* () { yield "Hi"; })() }, { model: "voxtral-mini-latest" },
  { language: "en" }, { speed: 1 }, { timestampGranularity: "word" }, { instructions: "whisper" },
  { output: { format: "pcm", sampleEncoding: "signed_integer_16" } }, { output: { format: "pcm", sampleRateHz: 44100 } },
  { output: { format: "wav", sampleEncoding: "float_32" } }, { output: { format: "mp3", bitRateBps: 128000 } },
  { referenceAudio: "base64" }, { metadata: { invalid: undefined } }, { metadata: { array: [undefined] } },
  { metadata: { array: new Array(1) } }, { metadata: new Date() }, { metadata: { integer: 1n } },
])("Mistral generated validator rejects invalid field %#", fields => {
  assert.throws(() => validateRequest({ text: "Hi", ...fields }), TypeError);
});
// @ts-expect-error Output streaming does not imply input streaming.
const streaming: TtsRequest = { text: (async function* () { yield "Hi"; })() };
// @ts-expect-error PCM is float32, not signed 16-bit.
const pcm: TtsRequest = { text: "Hi", output: { format: "pcm", sampleEncoding: "signed_integer_16" } };
// @ts-expect-error Required collection values cannot become undefined.
const metadata: TtsRequest = { text: "Hi", metadata: { nested: [undefined] } };
void [streaming, pcm, metadata];
