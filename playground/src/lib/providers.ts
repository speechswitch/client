import { createServerFn } from "@tanstack/react-start"

import type { ProviderOperation } from "./provider-schema"
import { providerSchemas, runProvider as runServerProvider } from "./providers.server"

export const listProviders = createServerFn({ method: "GET" })
  .handler(() => providerSchemas())

export const runProvider = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new TypeError("Invalid provider input")
    const { provider, operation, request } = input as Record<string, unknown>
    if (typeof provider !== "string") throw new TypeError("A provider is required")
    if (operation !== "synthesize" && operation !== "synthesizeWithTimestamps") {
      throw new TypeError("A valid provider operation is required")
    }
    return { provider, operation: operation as ProviderOperation, request }
  })
  .handler(async function* ({ data }) {
    yield* runServerProvider(data.provider, data.operation, data.request)
  })
