import { expect, test } from "bun:test";
import { isJsonValue } from "./json.ts";

test("JSON values preserve nested null, false, zero and shared non-cyclic objects", () => {
  const shared = { enabled: false, count: 0, value: null };
  expect(isJsonValue({ values: [shared, shared], nested: { array: [] }, text: "hello" })).toBe(true);
  expect(isJsonValue(Object.assign(Object.create(null), { value: "plain" }))).toBe(true);
});
test.each([undefined, NaN, Infinity, 1n, new Date(), new Map(), Uint8Array.of(1), [undefined], new Array(1), { nested: { missing: undefined } }, () => 1])("JSON rejects non-JSON data %# without lossy serialization", value => {
  expect(isJsonValue(value)).toBe(false);
});
test("JSON cycles fail instead of overflowing or silently serializing", () => {
  const value: { self?: unknown } = {}; value.self = value;
  expect(isJsonValue(value)).toBe(false);
});
