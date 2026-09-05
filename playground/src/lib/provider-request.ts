import type {
  DiscriminatedUnionSchema,
  JsonValue,
  PropertySchema,
  ProviderSchema,
  TypeSchema,
} from "./provider-schema.ts"

export type StreamingTextSegment = {
  text: string
  delayMs?: number
}

export function streamingTextSegments(values: readonly unknown[]): StreamingTextSegment[] {
  return values.map((value, index) => {
    if (typeof value === "string") return { text: value }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`Streaming text segment ${index + 1} must be a string or object`)
    }
    const { text, delayMs } = value as Record<string, unknown>
    if (typeof text !== "string") throw new TypeError(`Streaming text segment ${index + 1} must contain text`)
    if (
      delayMs !== undefined &&
      (typeof delayMs !== "number" || !Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 2_147_483_647)
    ) {
      throw new TypeError(`Streaming text segment ${index + 1} delayMs must be a non-negative integer`)
    }
    return delayMs === undefined ? { text } : { text, delayMs }
  })
}

export function providerRequest(
  request: unknown,
  streamingText: ProviderSchema["streamingText"],
): unknown {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    !("text" in request) ||
    !Array.isArray(request.text)
  ) {
    return request
  }
  const source = request as Record<string, unknown>
  const segments = streamingTextSegments(source.text as unknown[])
  if (!streamingText) throw new TypeError("This provider does not support streaming text")
  const resolved = materialize(streamingText.request, { ...source, text: "" } as JsonValue, false)
  // Arrays are the serializable playground wire representation of streaming text.
  return {
    ...(resolved as Record<string, JsonValue>),
    text: (async function* () {
      for (const segment of segments) {
        if (segment.delayMs) {
          await new Promise<void>((resolve) => setTimeout(resolve, segment.delayMs))
        }
        yield segment.text
      }
    })(),
  }
}

export function initialValue(schema: TypeSchema, optional = false): JsonValue | undefined {
  if (optional) return undefined
  switch (schema.kind) {
    case "string": return ""
    case "number": return 0
    case "boolean": return false
    case "enum": return schema.values[0]
    case "array": return []
    case "object": return Object.fromEntries(schema.properties.flatMap((property) => {
      const value = property.default !== undefined ? property.default : initialValue(property.schema, property.optional)
      return value === undefined ? [] : [[property.name, value]]
    }))
    case "discriminatedUnion": return schema.variants[0]
      ? initialValue(schema.variants[0].schema)
      : undefined
    case "union": return schema.variants[0] ? initialValue(schema.variants[0]) : undefined
    case "json": return ""
  }
}

export function selectedVariant(schema: DiscriminatedUnionSchema, value: JsonValue | undefined) {
  const discriminator = value && typeof value === "object" && !Array.isArray(value)
    ? value[schema.discriminator]
    : undefined
  const present = schema.variants.find((variant) => variant.present)
  if (present && discriminator !== undefined) return present
  if (discriminator === undefined || discriminator === "") return schema.variants.find((variant) => variant.omitted)
  if (typeof discriminator !== "string" && typeof discriminator !== "number" && typeof discriminator !== "boolean") return undefined
  return schema.variants.find((variant) => variant.values.includes(discriminator))
}

export function objectFields(schema: TypeSchema, value: JsonValue | undefined): PropertySchema[] {
  if (schema.kind === "object") return schema.properties
  if (schema.kind !== "discriminatedUnion") return []
  const variant = selectedVariant(schema, value) ?? schema.variants[0]!
  const fields = objectFields(variant.schema, value)
  const present = schema.variants.find((variant) => variant.present)
  const original = fields.find(({ name }) => name === schema.discriminator)
    ?? (present ? objectFields(present.schema, value).find(({ name }) => name === schema.discriminator) : undefined)
  return [{
    ...original,
    name: schema.discriminator,
    optional: schema.variants.some((variant) => variant.omitted),
    ...(present ? { presence: true } : {}),
    schema: present ? original!.schema : { kind: "enum", values: schema.variants.flatMap(({ values }) => values) },
  }, ...fields.filter(({ name }) => name !== schema.discriminator)]
}

export function changeSchemaField(schema: TypeSchema, value: JsonValue | undefined, name: string, next: JsonValue | undefined): JsonValue | undefined {
  if (schema.kind !== "discriminatedUnion") return undefined
  if (schema.discriminator === name) {
    if (selectedVariant(schema, value)?.present && next !== undefined) return undefined
    return selectDiscriminatedVariant(schema, value, next === "" && !schema.variants.some((variant) => variant.present) ? undefined : next)
  }
  const variant = selectedVariant(schema, value) ?? schema.variants[0]!
  return changeSchemaField(variant.schema, value, name, next)
}

class RequestFieldError extends TypeError {}

export function materialize(
  schema: TypeSchema,
  value: JsonValue | undefined,
  optional: boolean,
  path = "request",
): JsonValue | undefined {
  if ((value === undefined || value === "") && optional) return undefined
  try {
    switch (schema.kind) {
      case "string": {
        if (typeof value !== "string") throw new TypeError("Expected a string")
        return value
      }
      case "number": {
        if (value === undefined || value === null || value === "" || (typeof value !== "number" && typeof value !== "string")) throw new TypeError("Expected a number")
        const parsed = typeof value === "number" ? value : Number(value)
        if (!Number.isFinite(parsed)) throw new TypeError("Expected a number")
        return parsed
      }
      case "boolean": {
        if (typeof value !== "boolean") throw new TypeError("Expected a boolean")
        return value
      }
      case "enum": {
        if (!schema.values.some((candidate) => candidate === value)) {
          throw new TypeError(`Expected one of ${schema.values.join(", ")}`)
        }
        return value
      }
      case "array": {
        const item = (candidate: JsonValue, index: number): JsonValue => {
          const result = materialize(schema.item, candidate, false, `${path}[${index}]`)
          if (result === undefined) throw new TypeError("Expected an array item")
          return result
        }
        if (Array.isArray(value)) return value.map(item)
        const text = String(value ?? "").trim()
        if (!text) return []
        if (text.startsWith("[")) {
          const parsed = JSON.parse(text) as JsonValue
          if (!Array.isArray(parsed)) throw new TypeError("Expected an array")
          return parsed.map(item)
        }
        return text.split(/[,\n]/).map((value, index) => item(value.trim(), index))
      }
      case "object": {
        if (typeof value === "string" && value.trim().startsWith("{")) value = JSON.parse(value) as JsonValue
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected an object")
        const source = value
        for (const name of schema.forbidden ?? []) {
          if (source[name] !== undefined && source[name] !== "") throw new TypeError(`${name} is not supported by this variant`)
        }
        for (const [name, value] of Object.entries(source)) {
          if (value !== undefined && value !== "" && !schema.properties.some((property) => property.name === name)) {
            throw new TypeError(`${name} is not supported by this variant`)
          }
        }
        return Object.fromEntries(schema.properties.flatMap((property) => {
          const result = materialize(property.schema, source[property.name] === undefined ? property.default : source[property.name], property.optional, `${path}.${property.name}`)
          return result === undefined ? [] : [[property.name, result]]
        }))
      }
      case "discriminatedUnion": {
        const variant = selectedVariant(schema, value)
        if (!variant) throw new TypeError(`Expected a valid ${schema.discriminator}`)
        return materialize(variant.schema, value, optional, path)
      }
      case "union": {
        if (typeof value === "string" && /^[\[{]/.test(value.trim())) value = JSON.parse(value) as JsonValue
        const errors: string[] = []
        for (const variant of schema.variants) {
          try { return materialize(variant, value, optional, path) }
          catch (cause) { errors.push(cause instanceof Error ? cause.message : String(cause)) }
        }
        throw new TypeError(`No matching variant: ${errors.join("; ")}`)
      }
      case "json": {
        if (typeof value !== "string") return value
        return value.trim() ? JSON.parse(value) as JsonValue : undefined
      }
    }
  } catch (cause) {
    if (cause instanceof RequestFieldError) throw cause
    throw new RequestFieldError(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}

export function selectDiscriminatedVariant(
  schema: DiscriminatedUnionSchema,
  value: JsonValue | undefined,
  discriminator: JsonValue | undefined,
): JsonValue {
  const variant = schema.variants.find((candidate) => discriminator === undefined ? candidate.omitted : candidate.present
    || ((typeof discriminator === "string" || typeof discriminator === "number" || typeof discriminator === "boolean") && candidate.values.includes(discriminator)))
  if (!variant) throw new TypeError(`Expected a valid ${schema.discriminator}`)
  const current = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  const next = { ...current }
  if (discriminator === undefined) delete next[schema.discriminator]
  else next[schema.discriminator] = discriminator
  const result = reconcileValue(variant.schema, next)
  return result ?? {}
}

// Reconcile only on an explicit variant/input-mode change, never while validating or loading history.
export function reconcileValue(schema: TypeSchema, value: JsonValue | undefined): JsonValue | undefined {
  if (schema.kind === "discriminatedUnion") {
    const variant = selectedVariant(schema, value) ?? schema.variants[0]!
    return reconcileValue(variant.schema, value)
  }
  if (schema.kind === "object") {
    const current = value && typeof value === "object" && !Array.isArray(value) ? value : {}
    return Object.fromEntries(schema.properties.flatMap((property) => {
      if (current[property.name] === undefined) {
        const initial = property.default ?? initialValue(property.schema, property.optional)
        return initial === undefined ? [] : [[property.name, initial]]
      }
      let next: JsonValue | undefined
      try {
        materialize(property.schema, current[property.name], property.optional)
        next = current[property.name]
      } catch {
        next = property.schema.kind === "object" || property.schema.kind === "discriminatedUnion"
          ? reconcileValue(property.schema, current[property.name])
          : initialValue(property.schema, property.optional)
      }
      return next === undefined ? [] : [[property.name, next]]
    }))
  }
  try { return materialize(schema, value, false) }
  catch { return initialValue(schema) }
}

export function materializedRequest(provider: ProviderSchema, request: JsonValue): JsonValue {
  const source = request && typeof request === "object" && !Array.isArray(request)
    ? request as Record<string, JsonValue>
    : undefined
  const streamingSegments = Array.isArray(source?.text)
    ? streamingTextSegments(source.text)
    : undefined
  if (streamingSegments && !provider.streamingText) throw new TypeError("This provider does not support streaming text")
  const value = materialize(
    streamingSegments ? provider.streamingText!.request : provider.request,
    streamingSegments ? { ...source, text: streamingSegments[0]?.text ?? "" } : request,
    false,
  )
  if (value === undefined) throw new TypeError("The provider request is required")
  if (!streamingSegments || !value || typeof value !== "object" || Array.isArray(value)) return value
  return { ...value, text: streamingSegments }
}
