import path from "node:path"

import { PlaygroundSampleStore } from "./sample-store.server"

export const sampleStore = new PlaygroundSampleStore(
  path.resolve(process.cwd(), ".data/playground.sqlite"),
)
