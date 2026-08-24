import { expect, test } from "bun:test";
import { decodeBase64, encodeBase64 } from "./base64.ts";

test("base64 is an explicit wire conversion", () => {
  const bytes = Uint8Array.of(0, 1, 127, 128, 255);
  expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
});
