import { describe, expect, test } from "bun:test"

import { PlaygroundSampleStore } from "./sample-store.server"

describe("playground sample store", () => {
  test("remembers the last request for each provider operation", () => {
    const store = new PlaygroundSampleStore(":memory:")
    try {
      expect(store.providerState("amazon", "synthesize").lastRequest).toBeNull()
      store.saveLastSettings("amazon", "synthesize", { text: "hello" })
      expect(store.providerState("amazon", "synthesize").lastRequest).toEqual({ text: "hello" })
      expect(store.providerState("amazon", "synthesizeWithTimestamps").lastRequest).toBeNull()
    } finally {
      store.close()
    }
  })

  test("saves named samples and updates an existing name", () => {
    const store = new PlaygroundSampleStore(":memory:")
    try {
      const created = store.saveSample("amazon", "synthesize", "Joanna", { voice: "Joanna" })
      const updated = store.saveSample(
        "amazon",
        "synthesize",
        "Joanna",
        { voice: "Joanna", model: "neural" },
      )
      store.saveSample("amazon", "synthesize", "Amy", { voice: "Amy" })

      expect(updated.id).toBe(created.id)
      expect(store.providerState("amazon", "synthesize").samples).toHaveLength(2)
      expect(store.providerState("amazon", "synthesize").samples.find(({ name }) => name === "Joanna")?.request)
        .toEqual({ voice: "Joanna", model: "neural" })
    } finally {
      store.close()
    }
  })
})
