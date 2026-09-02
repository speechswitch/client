import { existsSync } from "node:fs"
import path from "node:path"

import { PlaygroundSampleStore } from "./sample-store.server"

const repositoryRoot = existsSync(path.resolve(process.cwd(), "schemas/tsconfig.json"))
  ? process.cwd()
  : path.resolve(process.cwd(), "..")

export const sampleStore = new PlaygroundSampleStore(
  path.resolve(repositoryRoot, "playground/.data/playground.sqlite"),
)
