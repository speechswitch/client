import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSpecMarkdown } from "./spec-render.ts";
import { extractSpeechSpec } from "./specgen.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = path.join(root, "sdk", "generated");
const providersDirectory = path.join(root, "schemas", "providers");
const providerFiles = await readdir(providersDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
const spec = extractSpeechSpec({
  root,
  tsconfig: "schemas/tsconfig.json",
  baseFile: "schemas/base.ts",
  providers: providerFiles
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      file: `schemas/providers/${entry.name}/index.ts`,
    })),
});
const outputs = new Map([
  [path.join(generated, "speech-spec.md"), renderSpecMarkdown(spec)],
  [path.join(generated, "speech-spec.json"), `${JSON.stringify(spec, null, 2)}\n`],
]);

if (process.argv.includes("--check")) {
  const stale: string[] = [];
  for (const [file, expected] of outputs) {
    const actual = await readFile(file, "utf8").catch(() => "");
    if (actual !== expected) stale.push(path.relative(root, file));
  }
  if (stale.length) {
    console.error(`Generated speech specification is stale: ${stale.join(", ")}. Run bun run generate:spec.`);
    process.exit(1);
  }
} else {
  await mkdir(generated, { recursive: true });
  for (const [file, contents] of outputs) await writeFile(file, contents);
  console.log(`Generated speech specification with ${spec.tts.providers.length} integration(s)`);
}
