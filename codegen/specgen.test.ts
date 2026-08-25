import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SpeechSpec } from "./spec-model.ts";

const directories: string[] = [];
const specgenUrl = pathToFileURL(path.join(import.meta.dir, "specgen.ts")).href;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function extract(base: string, provider?: string): Promise<{ readonly status: number; readonly output: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speech-switch-spec-"));
  directories.push(root);
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, lib: ["ESNext"], types: [] },
    include: ["*.ts"],
  }));
  await writeFile(path.join(root, "base.ts"), base);
  if (provider) await writeFile(path.join(root, "provider.ts"), provider);
  const script = [
    `import { extractSpeechSpec } from ${JSON.stringify(specgenUrl)};`,
    "try {",
    "  const root = process.argv[1];",
    `  const value = extractSpeechSpec({ root, tsconfig: "tsconfig.json", baseFile: "base.ts", providers: ${provider ? '[{ id: "fixture", file: "provider.ts" }]' : "[]"} });`,
    "  process.stdout.write(JSON.stringify(value));",
    "} catch (error) {",
    "  process.stderr.write(error instanceof Error ? error.message : String(error));",
    "  process.exitCode = 1;",
    "}",
  ].join("\n");
  const process = Bun.spawn(["node", "--input-type=module", "-e", script, root], {
    cwd: path.resolve(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { status, output: status === 0 ? stdout : stderr };
}

const base = `
/** Normalized request. */
export type TtsRequest = {
  /** Audio format. */
  readonly format?: "mp3" | "pcm" | "wav";
  /** Sample rate.\n   * @minimum 8000\n   * @maximum 48000\n   */
  readonly sampleRateHz?: number;
  /** Voice identifier. */
  readonly voice?: string;
  /** Reference audio bytes. */
  readonly referenceAudio?: Uint8Array;
  /** Provider labels. */
  readonly labels?: readonly string[];
};
`;

describe("TypeScript 7 speech specification", () => {
  test("extracts documented fields and valid provider narrowing", async () => {
    const result = await extract(base, `
      /** Provider request. */
      export type TtsRequest = {
        readonly format: "mp3" | "pcm";
        /** @minimum 16000 */
        readonly sampleRateHz?: number;
      };
    `);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    expect(spec.tts.providers[0]?.documentation).toBe("Provider request.");
    const request = spec.tts.providers[0]?.request;
    expect(request?.kind).toBe("object");
    if (request?.kind !== "object") throw new TypeError("Expected object request");
    expect(request.fields[0]?.documentation).toBe("Audio format.");
    expect(request.fields[1]?.constraints).toEqual({ minimum: 16000, maximum: 48000 });
  });

  test("classifies aliases through checker identities", async () => {
    const result = await extract(`
      type Audio = Uint8Array;
      type Input = AsyncIterable<string>;
      type Labels = ReadonlyArray<string>;
      namespace Vendor { export interface Uint8Array { readonly value: string } }
      /** Normalized request. */
      export type TtsRequest = {
        /** Audio bytes. */
        readonly audio?: Audio;
        /** Streaming input. */
        readonly input?: Input;
        /** Labels. */
        readonly labels?: Labels;
        /** Vendor object. */
        readonly vendorObject?: Vendor.Uint8Array;
      };
    `);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    expect(spec.tts.request.fields.map((field) => [field.name, field.type.kind])).toEqual([
      ["audio", "bytes"],
      ["input", "async-iterable"],
      ["labels", "array"],
      ["vendorObject", "object"],
    ]);
  });

  test("does not erase undefined from required or nested types", async () => {
    const required = await extract(`
      /** Normalized request. */
      export type TtsRequest = {
        /** Required value. */
        readonly value: string | undefined;
      };
    `);
    expect(required.status).toBe(1);
    expect(required.output).toContain("undefined is only supported through optional properties");

    const nested = await extract(`
      /** Normalized request. */
      export type TtsRequest = {
        /** Values. */
        readonly values?: Array<string | undefined>;
      };
    `);
    expect(nested.status).toBe(1);
    expect(nested.output).toContain("undefined is only supported through optional properties");
  });

  test("preserves mutually exclusive request variants", async () => {
    const result = await extract(base, `
      type Voice = { readonly voice: string; readonly referenceAudio?: never };
      type Clone = { readonly voice?: never; readonly referenceAudio: Uint8Array };
      export type TtsRequest = Voice | Clone;
    `);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    const request = spec.tts.providers[0]?.request;
    expect(request?.kind).toBe("union");
    if (request?.kind !== "union") throw new TypeError("Expected request union");
    expect(request.anyOf).toHaveLength(2);
    expect(request.anyOf
      .map((part) => part.kind === "object" ? part.fields.map(({ name }) => name).join(",") : "")
      .sort()).toEqual(["referenceAudio", "voice"]);
  });

  test("reports all provider schema errors", async () => {
    const result = await extract(base, `
      export type TtsRequest = {
        readonly format?: "flac";
        readonly vendorOption?: string;
      };
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain("field format widens");
    expect(result.output).toContain("introduces unknown field vendorOption");
  });

  test("requires explicit provider fields", async () => {
    const result = await extract(base, `export type TtsRequest = { readonly [field: string]: string }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("must list normalized fields explicitly");
  });

  test("rejects partially overlapping unions", async () => {
    const result = await extract(base, `export type TtsRequest = { readonly format?: "mp3" | "flac" }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("field format widens");
  });

  test("rejects wider annotated constraints", async () => {
    const result = await extract(base, `
      export type TtsRequest = {
        /** @maximum 96000 */
        readonly sampleRateHz?: number;
      };
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain("constraints wider than the base field");
  });

  test("requires documentation on every public base field", async () => {
    const result = await extract(`export type TtsRequest = { readonly text?: string }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("public base field text must have documentation");
  });

  test("requires the base schema to be exported", async () => {
    const result = await extract(`type TtsRequest = { readonly text?: string }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("TtsRequest must be exported from base.ts");
  });
});
