import path from "node:path"
import { pathToFileURL } from "node:url"

import type { SpeechSpec } from "../../../codegen/spec-model.ts"

const repositoryRoot = path.resolve(import.meta.dir, "../../..")
const extractorUrl = pathToFileURL(path.join(repositoryRoot, "codegen/repository-spec.ts")).href

let cached: Promise<SpeechSpec> | undefined

export function repositorySpeechSpec(): Promise<SpeechSpec> {
  return cached ??= (async () => {
    const script = [
      `import { extractRepositorySpeechSpec } from ${JSON.stringify(extractorUrl)};`,
      "process.stdout.write(JSON.stringify(extractRepositorySpeechSpec(process.argv[1])));",
    ].join("\n")
    const child = Bun.spawn(["node", "--input-type=module", "-e", script, repositoryRoot], {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (status !== 0) throw new TypeError(stderr)
    return JSON.parse(stdout) as SpeechSpec
  })()
}
