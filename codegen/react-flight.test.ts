import { expect, test } from "bun:test";
import { reactFlightRecords, resolveReactFlightValue } from "./react-flight.ts";

test("decodes byte-counted UTF-8 text records split across chunks", () => {
  const value = "élan";
  const length = new TextEncoder().encode(value).length.toString(16);
  const html = [
    `<script>self.__next_f.push(${JSON.stringify([1, `a:T${length},é`])})</script>`,
    `<script>self.__next_f.push(${JSON.stringify([1, "lan\nb:{\"ok\":true}\n"])})</script>`,
  ].join("");
  expect(reactFlightRecords(html)).toEqual([
    { id: "a", kind: "text", value },
    { id: "b", kind: "json", value: { ok: true } },
  ]);
});

test("rejects unknown record kinds", () => {
  const html = `<script>self.__next_f.push(${JSON.stringify([1, "a:Zopaque\n"])})</script>`;
  expect(() => reactFlightRecords(html)).toThrow("Unknown React Flight record type: Z");
});

test("resolves record paths and undefined values", () => {
  const html = `<script>self.__next_f.push(${JSON.stringify([
    1,
    'a:{"values":["one","two"]}\nb:{"copy":"$a:values:1","absent":"$undefined"}\n',
  ])})</script>`;
  const records = reactFlightRecords(html);
  expect(resolveReactFlightValue(records, records[1]!.value)).toEqual({ copy: "two", absent: undefined });
});

test("preserves escaped dollar-prefixed literals", () => {
  const html = `<script>self.__next_f.push(${JSON.stringify([1, 'a:{"key":"$$CARTESIA_API_KEY"}\n'])})</script>`;
  const records = reactFlightRecords(html);
  expect(resolveReactFlightValue(records, records[0]!.value)).toEqual({ key: "$CARTESIA_API_KEY" });
});
