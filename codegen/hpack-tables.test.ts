import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderHpackTables } from "./hpack-tables.ts";

const raw = readFileSync(new URL("../schemas/sources/google/08-hpack-rfc7541.txt", import.meta.url), "utf8");

test("HPACK tables require the entire indexed normative tables and consistent codes", () => {
  expect(() => renderHpackTables(raw.replace(/^.*\| 61 .*\n/m, ""))).toThrow(new TypeError("Incomplete HPACK static table"));
  expect(() => renderHpackTables(raw.replace(/^.*\(  0\).*\n/m, ""))).toThrow(new TypeError("Incomplete HPACK Huffman table"));
  expect(() => renderHpackTables(raw.replace("1ff8  [13]", "1ff9  [13]"))).toThrow(new TypeError("Inconsistent HPACK Huffman code"));
});
