import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { discoverProviders, renderProviderRegistry } from "./registry.ts";

const root = path.resolve(import.meta.dir, "..");
const providersDirectory = path.join(root, "sdk", "providers");
const output = path.join(root, "sdk", "generated", "provider-registry.ts");

const providers = await discoverProviders(providersDirectory);
const expected = renderProviderRegistry(providers);

if (process.argv.includes("--check")) {
  const actual = await readFile(output, "utf8").catch(() => "");
  if (actual !== expected) {
    console.error("Generated provider registry is stale. Run bun run generate:registry.");
    process.exit(1);
  }
} else {
  await mkdir(path.dirname(output), { recursive: true });
  await Bun.write(output, expected);
  console.log(`Generated provider registry with ${providers.length} integration(s)`);
}
