import { expect, expectTypeOf, test } from "bun:test";
import assert from "node:assert/strict";
import type { TtsRequest, UpdateCommand } from "../../../schemas/providers/kugelaudio/index.ts";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest as AmazonRequest } from "../../../schemas/providers/amazon/index.ts";
import type { TtsRequest as XaiRequest } from "../../../schemas/providers/xai/index.ts";
import { validateRequest } from "../../generated/validators/kugelaudio.ts";
import { validateRequest as validateXai } from "../../generated/validators/xai.ts";

const common = { voice: "custom-voice", output: { format: "pcm" } } as const;
async function* input() { yield "Hi"; yield { command: "update", speed: 1.1 } as const; yield { command: "clear" } as const; yield { command: "flush" } as const; }

test("KugelAudio's plain request and commands remain base subsets without widening other providers", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  expectTypeOf<AmazonRequest>().toExtend<BaseRequest>();
  expectTypeOf<XaiRequest>().toExtend<BaseRequest>();
  const valid: TtsRequest[] = [
    { ...common, text: "Hi", voice: 1071, output: { format: "pcm", sampleRateHz: 44100 } },
    { ...common, text: input(), language: "de", textFlushDelayMs: 500, textBufferThreshold: 1000 },
    { ...common, text: "Hi", output: { format: "mulaw", sampleRateHz: 8000 }, pronunciationDictionarySelection: { scope: 10, ids: [] } },
  ];
  for (const request of valid) expect(typeof validateRequest(request)).toBe("function");
  // @ts-expect-error G.711 is only documented at 8 kHz.
  const wrongRate: TtsRequest = { ...common, text: "Hi", output: { format: "mulaw", sampleRateHz: 24000 } };
  // @ts-expect-error Buffer controls belong to streaming input, not whole-text synthesis.
  const wrongBuffer: TtsRequest = { ...common, text: "Hi", textFlushDelayMs: 100 };
  // @ts-expect-error Dictionary IDs require their scope.
  const noScope: TtsRequest = { ...common, text: "Hi", pronunciationDictionarySelection: { ids: [7] } };
  // @ts-expect-error KugelAudio updates generation settings, not xAI replacements.
  const wrongUpdate: UpdateCommand = { command: "update", replacements: [] };
  // @ts-expect-error Amazon does not support an iterable of streaming commands.
  const amazon: AmazonRequest = { text: input(), voice: "Joanna", output: { format: "mp3" } };
  // @ts-expect-error xAI's update still requires replacements, and rejects KugelAudio controls.
  const xai: XaiRequest = { text: input(), voice: "eve", output: { format: "pcm" } };
  void amazon; void xai;
  for (const request of [wrongRate, wrongBuffer, noScope]) expect(() => validateRequest(request)).toThrow(TypeError);
  const validate = validateRequest(valid[1]); expect(() => validate(wrongUpdate)).toThrow(TypeError);
  const checkXai = validateXai({ text: (async function* () { yield "Hi"; })(), voice: "eve", output: { format: "pcm" } });
  expect(() => checkXai({ command: "update", speed: 1.1 })).toThrow(TypeError);
});

test("generated checks own literals, bounds and forbidden combinations", () => {
  for (const fields of [
    { text: "" }, { text: "   " }, { text: "a".repeat(10001) }, { speed: 0.7 }, { speed: 1.3 }, { temperature: -0.1 }, { temperature: 1.1 },
    { voiceGuidance: 1 }, { voiceGuidance: 3 }, { maxAudioTokens: 0 }, { maxAudioTokens: 2049 }, { language: "auto" }, { model: "2-turbo" },
    { output: { format: "mp3" } }, { output: { format: "pcm", byteOrder: "big_endian" } }, { output: { format: "pcm", sampleEncoding: "float_32" } },
    { timestampGranularity: "character" }, { timestampText: "original" }, { referenceAudio: Uint8Array.of(1) },
  ]) expect(() => validateRequest({ ...common, text: "Hi", ...fields })).toThrow(TypeError);
  const validate = validateRequest({ ...common, text: input() });
  for (const value of [" ", { command: "clear" }, { command: "flush" }, { command: "update", temperature: 0 }, { command: "update", textNormalization: false }]) expect(validate(value)).toBeUndefined();
  for (const [value, diagnostic] of [
    [{ command: "update", speed: 2 }, 'text item["speed"]: expected number <= 1.2'],
    [{ command: "update", maxAudioTokens: 1.5 }, 'text item["maxAudioTokens"]: expected safe integer'],
    [{ command: "update", replacements: [] }, 'text item["replacements"]: field is not allowed'],
    [{ command: "update", voice: "another" }, 'text item["voice"]: field is not allowed'],
  ] as const) {
    assert.throws(() => validate(value), new TypeError(`Invalid kugelaudio TTS input item:\ntext item: expected string\n${diagnostic}\ntext item["command"]: expected "clear"\ntext item["command"]: expected "flush"`));
  }
  assert.throws(() => validate(undefined), new TypeError("Invalid kugelaudio TTS input item:\ntext item: expected string\ntext item: expected object\ntext item: expected object\ntext item: expected object"));
});
