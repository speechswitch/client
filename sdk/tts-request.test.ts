import { describe, expect, expectTypeOf, test } from "bun:test";
import { textChunks } from "./tts-request.ts";
import type { TtsRequest } from "./tts-request.ts";

describe("normalized requests", () => {
  test("capabilities select and narrow request fields", () => {
    type Capabilities = { readonly text: string };
    expectTypeOf<TtsRequest<Capabilities>>().toEqualTypeOf<{ readonly text: string }>();
    expectTypeOf<TtsRequest<{ readonly text: string; readonly vendorOption: string }>>().toBeNever();
  });

  test("iterates static and streaming input consistently", async () => {
    const streamed = async function* () {
      yield "one";
      yield "two";
    };
    expect(await Array.fromAsync(textChunks("one"))).toEqual(["one"]);
    expect(await Array.fromAsync(textChunks(streamed()))).toEqual(["one", "two"]);
  });
});
