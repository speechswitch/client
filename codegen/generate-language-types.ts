import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepositorySpeechSpec } from "./repository-spec.ts";
import { languageTypeFiles } from "./language-types.ts";
import { extractSchemaTypes } from "./specgen.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = languageTypeFiles(extractRepositorySpeechSpec(root), extractSchemaTypes({
  root, tsconfig: "schemas/tsconfig.json", file: "schemas/stream.ts",
  names: ["Timestamp", "SynthesisEnvelope", "ClearEvent", "FlushEvent", "UpdatedEvent", "DoneEvent", "BatchEvent", "AudioStreamItem", "TimestampStreamItem", "AudioStream", "TimestampStream"],
}), extractSchemaTypes({
  root, tsconfig: "schemas/tsconfig.json", file: "schemas/transport.ts", names: ["SseMessage"],
}));
const stale: string[] = [];
for (const [file, expected] of files) {
  if (process.argv.includes("--check")) {
    if (await readFile(path.join(root, file), "utf8").catch(() => "") !== expected) stale.push(file);
  } else {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), expected);
  }
}
// Detect removed providers too; never silently retain stale generated APIs or
// delete files that might contain user changes.
for (const directory of ["sdks/rust/src/generated", "sdks/python/speechswitch/generated", "sdks/go/generated"]) {
  const entries = await readdir(path.join(root, directory), { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(rs|py|go)$/.test(entry.name)) continue;
    const file = path.relative(root, path.join(entry.parentPath, entry.name));
    if (!files.has(file)) stale.push(file);
  }
}
if (stale.length) {
  console.error(`Generated language types are stale: ${stale.join(", ")}. Run bun run generate:languages; review obsolete files explicitly.`);
  process.exitCode = 1;
} else console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"} ${files.size} Rust/Python/Go type files`);
