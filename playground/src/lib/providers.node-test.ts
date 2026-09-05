import assert from "node:assert/strict"
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

    assert.deepEqual(chunks, ["hello ", "world"])
    assert.equal(request.voice, "Joanna")
  })

  test("waits before sending a delayed streaming segment", async () => {
    const request = providerRequest({
      text: [{ text: "hello" }, { text: " world", delayMs: 20 }],
      model: "generative",
    }, streamingText) as { text: AsyncIterable<string> }

    const iterator = request.text[Symbol.asyncIterator]()
    assert.deepEqual(await iterator.next(), { done: false, value: "hello" })
    const started = performance.now()
    assert.deepEqual(await iterator.next(), { done: false, value: " world" })
    assert.ok(performance.now() - started >= 10)
  })

  test("leaves a single text string unchanged", () => {
    const request = { text: "hello", voice: "Joanna" }
    assert.equal(providerRequest(request, undefined), request)
  })

  test("rejects a streaming request outside its authored variant", () => {
    assert.throws(() => providerRequest({
      text: ["hello", "world"],
      model: "standard",
    }, streamingText), { name: "TypeError", message: "request.model: Expected one of generative" })
  })
})
