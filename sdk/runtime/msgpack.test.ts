import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodeMessagePack, encodeMessagePack } from "./msgpack.ts";

test("shared cross-language MessagePack goldens", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../sdks/fixtures/msgpack.json", import.meta.url), "utf8"), (_, value) => value && typeof value === "object" && "$bytes" in value ? Uint8Array.from(value.$bytes) : value);
  for (const [group, cases] of Object.entries(fixture) as Array<[string, any[]]>) {
    for (const item of cases) {
      const bytes = Uint8Array.from(Buffer.from(item.hex, "hex"));
      if (group === "invalid") expect(() => decodeMessagePack(bytes)).toThrow(new TypeError(item.error));
      else {
        expect(decodeMessagePack(bytes)).toEqual(item.value);
        if (group === "valid") expect(encodeMessagePack(item.value)).toEqual(bytes);
      }
    }
  }
});

test("matches MessagePack binary protocol fixtures independently of round trips", () => {
  expect(encodeMessagePack({ event: "audio", audio: Uint8Array.of(0, 255) })).toEqual(Uint8Array.of(0x82, 0xa5, 101, 118, 101, 110, 116, 0xa5, 97, 117, 100, 105, 111, 0xa5, 97, 117, 100, 105, 111, 0xc4, 2, 0, 255));
  expect(decodeMessagePack(Uint8Array.of(0x82, 0xa5, 101, 118, 101, 110, 116, 0xa6, 102, 105, 110, 105, 115, 104, 0xa6, 114, 101, 97, 115, 111, 110, 0xa4, 115, 116, 111, 112))).toEqual({ event: "finish", reason: "stop" });
});

test.each([null, true, false, 127, 128, 65535, 65536, 4294967295, -1, -32, -33, -1000, -2147483648, 1.25, "日本語", "a".repeat(300), "a".repeat(70000), Uint8Array.of(1, 2), new Uint8Array(300), new Uint8Array(300000), [1, "a"], Array.from({ length: 16 }, (_, i) => i), { optional: undefined, value: 0 }])("round trips scalar and container fixture %#", value => {
  const expected = value && typeof value === "object" && "optional" in value ? { value: 0 } : value;
  expect(decodeMessagePack(encodeMessagePack(value))).toEqual(expected);
});

test.each([
  { bytes: [0xca, 0x3f, 0xc0, 0, 0], value: 1.5 },
  { bytes: [0xcf, 0, 0, 0, 0, 0, 1, 0, 0], value: 65536 },
  { bytes: [0xd3, 255, 255, 255, 255, 255, 255, 255, 255], value: -1 },
  { bytes: [0xd0, 0x80], value: -128 },
  { bytes: [0xd1, 0x80, 0], value: -32768 },
])("decodes non-preferred but valid numeric encodings %#", ({ bytes, value }) => {
  expect(decodeMessagePack(Uint8Array.from(bytes))).toBe(value);
});

test.each([
  { bytes: [], message: "Truncated MessagePack value" },
  { bytes: [0xc4, 3, 1], message: "Truncated MessagePack value" },
  { bytes: [0xdd, 255, 255, 255, 255], message: "Truncated MessagePack value" },
  { bytes: [0xdf, 255, 255, 255, 255], message: "Truncated MessagePack value" },
  { bytes: [0, 1], message: "MessagePack frame contains trailing data" },
  { bytes: [0x81, 0, 1], message: "MessagePack map key is not a string" },
  { bytes: [0x82, 0xa1, 97, 1, 0xa1, 97, 2], message: "MessagePack map contains duplicate keys" },
  { bytes: [0xcf, 255, 255, 255, 255, 255, 255, 255, 255], message: "MessagePack integer exceeds the safe integer range" },
  { bytes: [0xc1], message: "Unsupported MessagePack marker: 0xc1" },
])("rejects malformed data: $message %#", ({ bytes, message }) => {
  expect(() => decodeMessagePack(Uint8Array.from(bytes))).toThrow(new TypeError(message));
});

test("preserves __proto__ as a data key without changing the object's prototype", () => {
  const value = JSON.parse('{"__proto__":{"polluted":true}}');
  const decoded = decodeMessagePack(encodeMessagePack(value));
  expect(decoded).toEqual(value); expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
  expect(Object.hasOwn(decoded as object, "__proto__")).toBe(true);
});

test("bounds nesting and respects subarray offsets", () => {
  const nested = Uint8Array.from([...Array(66).fill(0x91), 0]);
  expect(() => decodeMessagePack(nested)).toThrow(new TypeError("MessagePack nesting exceeds 64 levels"));
  let value: unknown = 0; for (let i = 0; i < 66; i++) value = [value];
  expect(() => encodeMessagePack(value)).toThrow(new TypeError("MessagePack nesting exceeds 64 levels"));
  expect(decodeMessagePack(Uint8Array.of(99, 0xc4, 2, 1, 2, 99).subarray(1, 5))).toEqual(Uint8Array.of(1, 2));
});
