import { createServerFn } from "@tanstack/react-start"

import type { JsonValue, ProviderOperation } from "./provider-schema"
import { sampleStore } from "./samples.server"

export type {
  PlaygroundSample,
  PlaygroundProviderState,
} from "./sample-store.server"

function providerInput(input: unknown): { provider: string; operation: ProviderOperation } {
  if (!input || typeof input !== "object") throw new TypeError("Invalid playground provider input")
  const { provider, operation } = input as Record<string, unknown>
  if (typeof provider !== "string" || !provider.trim()) {
    throw new TypeError("A playground provider is required")
  }
  if (operation !== "synthesize" && operation !== "synthesizeWithTimestamps") {
    throw new TypeError("A valid playground operation is required")
  }
  return { provider, operation }
}

function settingsInput(input: unknown): {
  provider: string
  operation: ProviderOperation
  request: JsonValue
} {
  const parsed = providerInput(input)
  const { request } = input as Record<string, unknown>
  const serialized = JSON.stringify(request)
  if (serialized === undefined) throw new TypeError("Playground settings must be JSON serializable")
  return { ...parsed, request: JSON.parse(serialized) as JsonValue }
}

export const loadProviderState = createServerFn({ method: "GET" })
  .validator(providerInput)
  .handler(({ data }) => sampleStore.providerState(data.provider, data.operation))

export const saveLastSettings = createServerFn({ method: "POST" })
  .validator(settingsInput)
  .handler(({ data }) => {
    sampleStore.saveLastSettings(data.provider, data.operation, data.request)
  })

export const saveNamedSample = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const parsed = settingsInput(input)
    const { name } = input as Record<string, unknown>
    if (typeof name !== "string" || !name.trim()) throw new TypeError("A sample name is required")
    if (name.trim().length > 120) throw new TypeError("Sample names may not exceed 120 characters")
    return { ...parsed, name: name.trim() }
  })
  .handler(({ data }) => sampleStore.saveSample(
    data.provider,
    data.operation,
    data.name,
    data.request,
  ))
