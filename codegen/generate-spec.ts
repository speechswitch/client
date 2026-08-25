import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverProviders } from "./registry.ts";
import { renderSpecMarkdown, renderZodSchemas } from "./spec-render.ts";
import { extractSpeechSpec } from "./specgen.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = path.join(root, "generated");
const providerEntries = await discoverProviders(path.join(root, "sdk", "providers"));
const spec = extractSpeechSpec({
  root,
  providers: providerEntries.map((provider) => ({
    id: provider.name,
    file: path.relative(root, path.resolve(generated, provider.module)),
  })),
});
const outputs = new Map([
  [path.join(generated, "speech-spec.md"), renderSpecMarkdown(spec)],
  [path.join(generated, "tts-schemas.ts"), renderZodSchemas(spec)],
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
