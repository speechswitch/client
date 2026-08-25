import { describe, expect, test } from "bun:test";
import { ttsRequestBaseSchema } from "./tts-schemas.ts";

describe("generated TTS request schema", () => {
  test("accepts whole and streaming text without consuming the stream", async () => {
    let consumed = false;
    const stream = (async function* () {
      consumed = true;
      yield "hello";
    })();
    expect(ttsRequestBaseSchema.safeParse({ text: "hello" }).success).toBe(true);
    expect((await ttsRequestBaseSchema.safeParseAsync({ text: stream })).success).toBe(true);
    expect(consumed).toBe(false);
  });

  test("rejects invalid text and unknown normalized fields", () => {
    expect(ttsRequestBaseSchema.safeParse({ text: 42 }).success).toBe(false);
    expect(ttsRequestBaseSchema.safeParse({ vendorOption: true }).success).toBe(false);
  });
});
