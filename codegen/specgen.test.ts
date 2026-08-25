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
    `  const value = extractSpeechSpec({ root, baseFile: "base.ts", providers: ${provider ? '[{ id: "fixture", file: "provider.ts" }]' : "[]"} });`,
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
export interface TtsRequestBase {
  /** Audio format. */
  readonly format?: "mp3" | "pcm" | "wav";
  /** Sample rate.\n   * @minimum 8000\n   * @maximum 48000\n   */
  readonly sampleRateHz?: number;
}
export type TtsRequest<Capabilities extends Partial<TtsRequestBase>> = {
  readonly [Key in keyof Capabilities]: Capabilities[Key];
};
`;

describe("TypeScript 7 speech specification", () => {
  test("extracts documented fields and valid provider narrowing", async () => {
    const result = await extract(base, `
      import type { TtsRequest } from "./base.ts";
      export interface TtsModels {
        /** Fast model. */
        readonly "model-1": TtsRequest<{
          readonly format: "mp3" | "pcm";
          /** @minimum 16000 */
          readonly sampleRateHz?: number;
        }>;
      }
    `);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    expect(spec.tts.providers[0]?.models[0]?.id).toBe("model-1");
    expect(spec.tts.providers[0]?.models[0]?.fields[0]?.documentation).toBe("Audio format.");
    expect(spec.tts.providers[0]?.models[0]?.fields[1]?.constraints).toEqual({ minimum: 16000, maximum: 48000 });
  });

  test("rejects fields outside the normalized vocabulary", async () => {
    const result = await extract(base, `export interface TtsModels { model: { readonly vendorOption?: string } }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("introduces unknown field vendorOption");
  });

  test("requires exact model identifiers", async () => {
    const result = await extract(base, `export interface TtsModels { readonly [model: string]: { readonly format?: "mp3" } }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("must list exact model identifiers");
  });

  test("rejects partially overlapping unions", async () => {
    const result = await extract(base, `export interface TtsModels { model: { readonly format?: "mp3" | "flac" } }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("field format widens");
  });

  test("rejects wider annotated constraints", async () => {
    const result = await extract(base, `
      export interface TtsModels {
        model: {
          /** @maximum 96000 */
          readonly sampleRateHz?: number;
        };
      }
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain("constraints wider than the base field");
  });

  test("requires documentation on every public base field", async () => {
    const result = await extract(`export interface TtsRequestBase { readonly text?: string }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("public base field text must have documentation");
  });
});
