import { expect } from "expect";
import { afterEach, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractSpeechSpec } from "./specgen.ts";
import { renderRequestValidator } from "./request-validator.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const base = `export type TtsRequest = {
  /** X. */ x?: number;
  /** Y. */ y?: string | null;
  /** Z. */ z?: { x: number[]; y?: number };
  /** Input. */ text?: AsyncIterable<"x" | "y">;
};`;
async function generated(source: string) {
  const root = await mkdtemp(path.join(tmpdir(), "speechswitch-validator-"));
  directories.push(root);
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, lib: ["ESNext"], types: [] },
      include: ["*.ts"],
    }),
  );
  await writeFile(path.join(root, "base.ts"), base);
  await writeFile(path.join(root, "provider.ts"), source);
  const spec = extractSpeechSpec({
    root,
    tsconfig: "tsconfig.json",
    baseFile: "base.ts",
    providers: [{ id: "fixture", file: "provider.ts" }],
  });
  const code = renderRequestValidator(spec.tts.providers[0]!);
  const output = path.join(root, "validator.mts");
  await writeFile(output, code);
  const module = await import(pathToFileURL(output).href);
  return {
    defaults: module.requestDefaults,
    validate: module.validateRequest as (value: unknown) => (item: unknown) => void,
  };
}

test("exports defaults without mutating input", async () => {
  const { validate, defaults } = await generated(`export type TtsRequest = {
    /** @default 1 */ x?: number;
    y?: never;
  };`);
  const request = {};
  expect(defaults).toStrictEqual({ x: 1 });
  expect(() => validate(request)).not.toThrow();
  expect(request).toStrictEqual({});
  expect(() => validate({ x: undefined, y: undefined })).not.toThrow();
});

test("accumulates errors and discards failed alternatives of a valid union", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    /** @maximum 1 */ x: number;
    y: string | null;
    z: { x: number[] };
  };`);
  expect(() => validate({ x: 2, y: null, z: { x: [null, false] } })).toThrow(
    new TypeError(`Invalid fixture TTS request:
request["x"]: expected number <= 1
request["z"]["x"][0]: expected finite number
request["z"]["x"][1]: expected finite number`),
  );
});

test("stops at invalid containers and continues with siblings", async () => {
  const { validate } = await generated(
    `export type TtsRequest = { x: number; z: { x: number[] } };`,
  );
  expect(() => validate({ z: null })).toThrow(
    new TypeError(`Invalid fixture TTS request:
request["x"]: required field
request["z"]: expected object`),
  );
});

test("validates input against the selected variant without opening the iterator", async () => {
  const { validate } = await generated(`export type TtsRequest =
    | { x: 1; text: AsyncIterable<"x"> }
    | { x: 2; text: AsyncIterable<"y"> };`);
  const text = {
    [Symbol.asyncIterator]() {
      throw new Error("Must not open iterator");
    },
  };
  let reads = 0;
  const first = validate({
    x: 1,
    get text() {
      reads++;
      return text;
    },
  });
  expect(reads).toBe(1);
  expect(() => first("x")).not.toThrow();
  const second = validate({ x: 2, text });
  expect(() => second("y")).not.toThrow();
  expect(() => second("x")).toThrow(
    new TypeError(`Invalid fixture TTS input item:
text item: expected "y"`),
  );
});

test("dispatches nested unions and reports only the selected branch's errors", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    z: { y: 1; x: number[] } | { y: 2; x: number[] };
  };`);
  let reads = 0;
  validate({
    z: {
      y: 2,
      get x() {
        reads++;
        return [1];
      },
    },
  });
  expect(reads).toBe(1);
  expect(() => validate({ z: { y: 2, x: false } })).toThrow(
    new TypeError(`Invalid fixture TTS request:
request["z"]["x"]: expected array`),
  );
  expect(() => validate({ z: { y: 3, x: [] } })).toThrow(
    new TypeError(`Invalid fixture TTS request:
request["z"]["y"]: expected one of 1, 2`),
  );
});

test("dispatches optional and overlapping literal tags without rechecking candidates", async () => {
  const { validate } = await generated(`export type TtsRequest =
    | { x?: 1 | 2; text: AsyncIterable<"x"> }
    | { x: 2 | 3; text: AsyncIterable<"y"> };`);
  const text = (async function* () {})();
  let reads = 0;
  const both = validate({
    x: 2,
    get text() {
      reads++;
      return text;
    },
  });
  expect(reads).toBe(2);
  expect(() => both("x")).not.toThrow();
  expect(() => both("y")).not.toThrow();
  const omitted = validate({ text });
  expect(() => omitted("x")).not.toThrow();
  expect(() => omitted("y")).toThrow(
    new TypeError(`Invalid fixture TTS input item:
text item: expected "x"`),
  );
});

test("accepts either matching variant and keeps errors local to each item", async () => {
  const { validate } = await generated(`export type TtsRequest =
    | { text: AsyncIterable<"x"> }
    | { text: AsyncIterable<"y"> };`);
  const check = validate({ text: (async function* () {})() });
  expect(() => check("y")).not.toThrow();
  expect(() => check("z")).toThrow(
    new TypeError(`Invalid fixture TTS input item:
text item: expected "x"
text item: expected "y"`),
  );
  expect(() => check("x")).not.toThrow();
});
