import { expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest } from "../../../schemas/providers/inworld/index.ts";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import { validateRequest } from "../../generated/validators/inworld.ts";

const common = { voice: "existing-custom-voice", output: { format: "pcm" } } as const;
async function* input() { yield "Hello"; yield { command: "flush" } as const; }

test("Inworld authored model and input alternatives remain provider subsets", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const valid: TtsRequest[] = [
    { ...common, model: "inworld-tts-2", text: "Hello", deliveryMode: "creative", instructions: "speak softly" },
    { ...common, model: "inworld-tts-2-flash", text: "Hello" },
    { ...common, model: "inworld-tts-1.5-max", text: "Hello", temperature: 2 },
    { ...common, model: "inworld-tts-1.5-mini", text: input(), temperature: 0 },
    { ...common, model: "inworld-tts-2", text: input(), automaticTextFlushing: true, timestampGranularity: "word", timestampDelivery: "trailing" },
  ];
  for (const request of valid) expect(typeof validateRequest(request)).toBe("function");
  // @ts-expect-error TTS-2 does not honor temperature.
  const wrongTemperature: TtsRequest = { ...common, model: "inworld-tts-2", text: "Hi", temperature: 1 };
  // @ts-expect-error Flash does not support steering.
  const wrongInstructions: TtsRequest = { ...common, model: "inworld-tts-2-flash", text: "Hi", instructions: "whisper" };
  // @ts-expect-error The socket has no request-level instruction field.
  const socketInstructions: TtsRequest = { ...common, model: "inworld-tts-2", text: input(), instructions: "whisper" };
  // @ts-expect-error FLAC is not documented for WebSocket.
  const socketFlac: TtsRequest = { ...common, model: "inworld-tts-2", text: input(), output: { format: "flac" } };
  for (const request of [wrongTemperature, wrongInstructions, socketInstructions, socketFlac]) expect(() => validateRequest(request)).toThrow(TypeError);
});

test("generated Inworld checks own bounds, unsupported controls and per-input command narrowing", () => {
  const request = { ...common, model: "inworld-tts-2", text: "Hello" } as const;
  for (const overrides of [
    { text: "" }, { text: "a".repeat(4001) }, { speed: 0.49 }, { speed: 1.51 },
    { output: { format: "pcm", bitRateBps: 128000 } }, { output: { format: "mulaw", sampleRateHz: 24000 } },
    { deliveryMode: "expressive" }, { referenceAudio: Uint8Array.of(1) },
  ]) expect(() => validateRequest({ ...request, ...overrides })).toThrow(TypeError);
  const validate = validateRequest({ ...request, text: input() });
  expect(validate("token")).toBeUndefined(); expect(validate({ command: "flush" })).toBeUndefined();
  expect(() => validate({ command: "clear" })).toThrow(TypeError);
  expect(() => validate({ command: "update", replacements: [] })).toThrow(TypeError);
});
