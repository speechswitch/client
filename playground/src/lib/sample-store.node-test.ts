import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { PlaygroundSampleStore } from "./sample-store.server.ts"

describe("playground sample store", () => {
  test("remembers the last request for each provider", () => {
    const store = new PlaygroundSampleStore(":memory:")
    try {
      assert.equal(store.providerState("amazon").lastRequest, null)
      store.saveLastSettings("amazon", { text: "hello" })
      assert.deepEqual(store.providerState("amazon").lastRequest, { text: "hello" })
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

      assert.equal(updated.id, created.id)
      const samples = store.providerState("amazon").samples
      assert.equal(samples.length, 2)
      assert.deepEqual(samples.find(({ name }) => name === "Joanna")?.request, {
        voice: "Joanna",
        model: "neural",
      })
    } finally {
      store.close()
    }
  })
})
