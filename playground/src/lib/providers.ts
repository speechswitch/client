import { createServerFn } from "@tanstack/react-start"

import { providerSchemas, runProvider as runServerProvider } from "./providers.server"

export const listProviders = createServerFn({ method: "GET" })
  .handler(() => providerSchemas)

export const runProvider = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new TypeError("Invalid provider input")
    const { provider, request } = input as Record<string, unknown>
    if (typeof provider !== "string") throw new TypeError("A provider is required")
    return { provider, request }
  })
  .handler(async function* ({ data }) {
    yield* runServerProvider(data.provider, data.request)
  })
