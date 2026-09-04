import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { extractSpeechSpec } from "./specgen.ts";

export function extractRepositorySpeechSpec(root: string) {
  const providersDirectory = path.join(root, "schemas", "providers");
  return extractSpeechSpec({
    root,
    tsconfig: "schemas/tsconfig.json",
    baseFile: "schemas/base.ts",
    providers: existsSync(providersDirectory)
      ? readdirSync(providersDirectory, { withFileTypes: true }).flatMap((entry) => {
          if (entry.isFile() && entry.name.endsWith(".ts")) {
            return [{ id: entry.name.slice(0, -3), file: path.join(providersDirectory, entry.name) }];
          }
          const file = path.join(providersDirectory, entry.name, "index.ts");
          return entry.isDirectory() && existsSync(file) ? [{ id: entry.name, file }] : [];
        })
      : [],
  });
}
