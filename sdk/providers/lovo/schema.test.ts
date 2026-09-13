import { expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest } from "../../../schemas/providers/lovo/index.ts";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import { validateRequest } from "../../generated/validators/lovo.ts";

test("LOVO plain request remains a base subset and exposes only wire-supported controls", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const request: TtsRequest = { text: "Hi", voice: "speaker", voiceStyle: "style", speed: 0.05 }; expect(typeof validateRequest(request)).toBe("function");
  expect(typeof validateRequest({ ...request, text: "😀".repeat(500) })).toBe("function");
  expect(() => validateRequest({ ...request, text: "😀".repeat(501) })).toThrow(TypeError);
  // @ts-expect-error Model is determined by the voice, not a synthesis request field.
  const model: TtsRequest = { ...request, model: "pro-v2" };
  // @ts-expect-error Genny returns URLs with provider-chosen audio format.
  const output: TtsRequest = { ...request, output: { format: "wav" } };
  // @ts-expect-error No timestamps endpoint is documented.
  const timed: TtsRequest = { ...request, timestampGranularity: "word" };
  // @ts-expect-error A complete text string is required, not an iterable of strings or commands.
  const streamed: TtsRequest = { ...request, text: (async function* () { yield "Hi"; })() };
  for (const value of [model, output, timed, streamed, { ...request, text: "" }, { ...request, text: "a".repeat(501) }, { ...request, voice: "" }, { ...request, speed: 0.01 }, { ...request, speed: 3.1 }]) {
    expect(() => validateRequest(value)).toThrow(TypeError);
  }
});
