import { expect, expectTypeOf, test } from "bun:test";
import assert from "node:assert/strict";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import { synthesize, type TtsRequest } from "./index.ts";
import { requestDefaults, validateRequest } from "../../generated/validators/respeecher.ts";

test("Respeecher types preserve provider capability narrowing over the flat base", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const text = (async function* () { yield "Hello"; yield { command: "clear" } as const; yield { command: "flush" } as const; })();
  const requests: TtsRequest[] = [
    { voice: "custom", text, language: "uk", output: { format: "pcm", sampleEncoding: "float_32" } },
    { voice: "custom", text: "Hello", output: { format: "wav" } },
    { voice: "custom", text: "Hello", output: { format: "mulaw", sampleRateHz: 8000 } },
    { voice: "custom", text: "Hello", topK: 0, topP: Number.MIN_VALUE, temperature: 0, presencePenalty: 0, frequencyPenalty: 0, randomSeed: 0 },
  ];
  for (const request of requests) expect(() => validateRequest(request)).not.toThrow();
  expect(requestDefaults).toEqual({ language: "en", model: "realtime-tts" });
  // @ts-expect-error WAV is a whole-text HTTP capability, not streaming input.
  const wave: TtsRequest = { voice: "custom", text, output: { format: "wav" } };
  // @ts-expect-error The Space API has no reference-audio input.
  const reference: TtsRequest = { voice: "custom", text: "Hello", referenceAudio: Uint8Array.of(1) };
  // @ts-expect-error No timestamp output exists in the native protocol.
  const timestamps: TtsRequest = { voice: "custom", text: "Hello", timestampGranularity: "word" };
  // @ts-expect-error Mulaw has no PCM sample representation setting.
  const mulaw: TtsRequest = { voice: "custom", text: "Hello", output: { format: "mulaw", sampleEncoding: "float_32" } };
  // @ts-expect-error No pronunciation-session updates exist.
  const update: TtsRequest = { voice: "custom", text: (async function* () { yield { command: "update", replacements: [] } as const; })() };
  void [wave, reference, timestamps, mulaw, update];
});

test.each([
  { voice: "" }, { topK: -1 }, { topK: 0.5 }, { randomSeed: 1.5 }, { randomSeed: Number.MAX_SAFE_INTEGER + 1 },
  { topP: 0 }, { topP: -0.1 }, { topP: 1.1 }, { temperature: -0.1 }, { minP: 1.1 },
  { presencePenalty: 2.1 }, { frequencyPenalty: -0.1 }, { repetitionPenalty: 0.9 },
  { output: { format: "pcm", sampleRateHz: 0 } }, { output: { format: "pcm", sampleRateHz: 22050.5 } },
  { output: { format: "wav", sampleEncoding: "float_32" } }, { output: { format: "mp3" } },
  { output: { format: "pcm", byteOrder: "big_endian" } }, { output: { format: "pcm", channelCount: 2 } },
  { referenceAudio: Uint8Array.of(1) }, { timestampGranularity: "word" }, { language: "auto" }, { model: "unknown" },
])("generated Respeecher validation rejects unsupported value %# before networking", async fields => {
  const request = { voice: "custom", text: "Hello", ...fields };
  let expected: unknown;
  try { validateRequest(request); } catch (error) { expected = error; }
  assert(expected instanceof TypeError);
  let called = false;
  await expect(synthesize(request as TtsRequest, { fetch: async () => { called = true; throw new Error("unexpected network"); } }).next()).rejects.toEqual(expected);
  expect(called).toBe(false);
});

test("input validation does not acquire the producer and checks each control", () => {
  let acquired = false;
  const text = { [Symbol.asyncIterator](): AsyncIterator<string> { acquired = true; throw new Error("must not acquire"); } };
  const check = validateRequest({ voice: "custom", text });
  for (const value of ["Hello", { command: "clear" }, { command: "flush" }]) expect(() => check(value)).not.toThrow();
  assert.throws(() => check(undefined), {
    name: "TypeError", message: [
      "Invalid respeecher TTS input item:",
      "text item: expected string",
      "text item: expected object",
      "text item: expected object",
    ].join("\n"),
  });
  for (const command of ["cancel", "update"]) assert.throws(() => check({ command }), {
    name: "TypeError", message: [
      "Invalid respeecher TTS input item:",
      "text item: expected string",
      'text item["command"]: expected "clear"',
      'text item["command"]: expected "flush"',
    ].join("\n"),
  });
  expect(acquired).toBe(false);
  expect(() => validateRequest({ voice: "custom", text, output: { format: "wav" } })).toThrow(TypeError);
});
