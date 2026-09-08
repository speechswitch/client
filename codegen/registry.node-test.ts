import { expect } from "expect";
import { afterEach, describe, test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { discoverProviders, renderProviderRegistry } from "./registry.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "speech-switch-registry-"));
  directories.push(directory);
  return directory;
}

describe("integration registry", () => {
  test("renders a valid empty registry when the directory is absent", async () => {
    const entries = await discoverProviders(path.join(await fixture(), "missing"));
    expect(entries).toStrictEqual([]);
    expect(renderProviderRegistry(entries)).toContain("export const providers = {\n} as const;");
  });

  test("supports both file and directory integration layouts", async () => {
    const directory = await fixture();
    await writeFile(path.join(directory, "compact.ts"), "export {};\n");
    await mkdir(path.join(directory, "expanded"));
    await writeFile(path.join(directory, "expanded", "index.ts"), "export {};\n");
    expect(await discoverProviders(directory)).toStrictEqual([
      { name: "compact", module: "../providers/compact.ts" },
      { name: "expanded", module: "../providers/expanded/index.ts" },
    ]);
  });

  test("rejects ambiguous duplicate layouts", async () => {
    const directory = await fixture();
    await writeFile(path.join(directory, "duplicate.ts"), "export {};\n");
    await mkdir(path.join(directory, "duplicate"));
    await writeFile(path.join(directory, "duplicate", "index.ts"), "export {};\n");
    await expect(discoverProviders(directory)).rejects.toThrow(/both file and directory layouts/);
  });
});
