import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepositorySpeechSpec } from "./repository-spec.ts";
import { renderSpecMarkdown } from "./spec-render.ts";
import { renderRequestValidator } from "./request-validator.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = path.join(root, "sdk", "generated");
const spec = extractRepositorySpeechSpec(root);
const outputs = new Map([
  [path.join(generated, "speech-spec.md"), renderSpecMarkdown(spec)],
]);
for (const provider of spec.tts.providers) {
  outputs.set(path.join(generated, "validators", `${provider.id}.ts`), renderRequestValidator(provider));
}

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
  for (const [file, contents] of outputs) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  console.log(`Generated speech specification with ${spec.tts.providers.length} integration(s)`);
}
