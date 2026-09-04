import { expect, test } from "bun:test";
import { decodeMessagePack, encodeMessagePack } from "./msgpack.ts";

test("round trips the MessagePack values used by TTS protocols", () => {
  const value = {
    event: "start",
    request: {
      text: "héllo",
      audio: Uint8Array.of(1, 2, 3),
      settings: [true, false, null, 0.7, 300, -1],
      omitted: undefined,
    },
  };
  expect(decodeMessagePack(encodeMessagePack(value))).toEqual({
    event: "start",
    request: {
      text: "héllo",
      audio: Uint8Array.of(1, 2, 3),
      settings: [true, false, null, 0.7, 300, -1],
    },
  });
});
