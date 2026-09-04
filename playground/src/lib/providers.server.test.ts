import { describe, expect, test } from "bun:test"

import { providerRequest } from "./provider-request"

describe("playground provider requests", () => {
  test("uses added text chunks as streaming input without a mode switch", async () => {
    const request = providerRequest("synthesize", {
      text: ["hello ", "world"],
      voice: "Joanna",
      model: "generative",
    }, {
      constraints: { model: "generative" },
    }) as { text: AsyncIterable<string>; voice: string }

    const chunks: string[] = []
    for await (const chunk of request.text) chunks.push(chunk)

    expect(chunks).toEqual(["hello ", "world"])
    expect(request.voice).toBe("Joanna")
  })

  test("waits before sending a delayed streaming segment", async () => {
    const request = providerRequest("synthesize", {
      text: [{ text: "hello" }, { text: " world", delayMs: 20 }],
      model: "generative",
    }, {
      constraints: { model: "generative" },
    }) as { text: AsyncIterable<string> }

    const iterator = request.text[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: "hello" })
    const started = performance.now()
    expect(await iterator.next()).toEqual({ done: false, value: " world" })
    expect(performance.now() - started).toBeGreaterThanOrEqual(10)
  })

  test("leaves a single text string unchanged", () => {
    const request = { text: "hello", voice: "Joanna" }
    expect(providerRequest("synthesize", request, undefined)).toBe(request)
  })

  test("rejects a streaming request outside its authored variant", () => {
    expect(() => providerRequest("synthesize", {
      text: ["hello", "world"],
      model: "standard",
    }, {
      constraints: { model: "generative" },
    })).toThrow("Streaming text requires model to be generative")
  })
})
