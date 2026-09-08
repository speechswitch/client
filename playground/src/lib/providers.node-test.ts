import { expect } from "expect"
import { describe, test } from "node:test"

import { providerRequest } from "./provider-request.ts"
import type { ProviderSchema } from "./provider-schema.ts"

const streamingText: NonNullable<ProviderSchema["streamingText"]> = { request: {
  kind: "object", properties: [
    { name: "text", optional: false, schema: { kind: "string" } },
    { name: "voice", optional: true, schema: { kind: "string" } },
    { name: "model", optional: false, schema: { kind: "enum", values: ["generative"] } },
  ],
} }

describe("playground provider requests", () => {
  test("uses added text chunks as streaming input without a mode switch", async () => {
    const request = providerRequest({
      text: ["hello ", "world"],
      voice: "Joanna",
      model: "generative",
    }, streamingText) as { text: AsyncIterable<string>; voice: string }

    const chunks: string[] = []
    for await (const chunk of request.text) chunks.push(chunk)

    expect(chunks).toStrictEqual(["hello ", "world"])
    expect(request.voice).toBe("Joanna")
  })

  test("waits before sending a delayed streaming segment", async () => {
    const request = providerRequest({
      text: [{ text: "hello" }, { text: " world", delayMs: 20 }],
      model: "generative",
    }, streamingText) as { text: AsyncIterable<string> }

    const iterator = request.text[Symbol.asyncIterator]()
    expect(await iterator.next()).toStrictEqual({ done: false, value: "hello" })
    const started = performance.now()
    expect(await iterator.next()).toStrictEqual({ done: false, value: " world" })
    expect(performance.now() - started).toBeGreaterThanOrEqual(10)
  })

  test("leaves a single text string unchanged", () => {
    const request = { text: "hello", voice: "Joanna" }
    expect(providerRequest(request, undefined)).toBe(request)
  })

  test("rejects a streaming request outside its authored variant", () => {
    expect(() => providerRequest({
      text: ["hello", "world"],
      model: "standard",
    }, streamingText)).toThrow(expect.objectContaining({ name: "TypeError", message: "request.model: Expected one of generative" }))
  })
})
