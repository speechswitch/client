import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ExtractSpeechSpecOptions } from "./specgen.ts";
import { extractSpeechSpec } from "./specgen.ts";

export function repositorySpeechSpecOptions(root: string): ExtractSpeechSpecOptions {
  const providersDirectory = path.join(root, "schemas", "providers");
  const providers = existsSync(providersDirectory)
    ? readdirSync(providersDirectory, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isFile() && entry.name.endsWith(".ts")) {
          return [{ id: entry.name.slice(0, -3), file: path.join(providersDirectory, entry.name) }];
        }
        const file = path.join(providersDirectory, entry.name, "index.ts");
        return entry.isDirectory() && existsSync(file) ? [{ id: entry.name, file }] : [];
      })
    : [];
  return {
    root,
    tsconfig: "schemas/tsconfig.json",
    baseFile: "schemas/base.ts",
    providers,
  };
}

export function extractRepositorySpeechSpec(root: string) {
  return extractSpeechSpec(repositorySpeechSpecOptions(root));
}
