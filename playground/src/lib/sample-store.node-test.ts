import { expect } from "expect"
import { describe, test } from "node:test"

import { PlaygroundSampleStore } from "./sample-store.server.ts"

describe("playground sample store", () => {
  test("remembers the last request for each provider", () => {
    const store = new PlaygroundSampleStore(":memory:")
    try {
      expect(store.providerState("amazon").lastRequest).toBe(null)
      store.saveLastSettings("amazon", { text: "hello" })
      expect(store.providerState("amazon").lastRequest).toStrictEqual({ text: "hello" })
    } finally {
      store.close()
    }
  })

  test("saves named samples and updates an existing name", () => {
    const store = new PlaygroundSampleStore(":memory:")
    try {
      const created = store.saveSample("amazon", "Joanna", { voice: "Joanna" })
      const updated = store.saveSample(
        "amazon",
        "Joanna",
        { voice: "Joanna", model: "neural" },
      )
      store.saveSample("amazon", "Amy", { voice: "Amy" })

      expect(updated.id).toBe(created.id)
      const samples = store.providerState("amazon").samples
      expect(samples).toHaveLength(2)
      expect(samples.find(({ name }) => name === "Joanna")?.request).toStrictEqual({
        voice: "Joanna",
        model: "neural",
      })
    } finally {
      store.close()
    }
  })
})
