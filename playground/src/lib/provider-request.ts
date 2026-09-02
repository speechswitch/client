import type {
  DiscriminatedUnionSchema,
  JsonValue,
  ProviderOperationSchema,
  TypeSchema,
} from "./provider-schema"

export function initialValue(schema: TypeSchema, optional = false): JsonValue | undefined {
  if (optional) return undefined
  switch (schema.kind) {
    case "string": return ""
    case "number": return 0
    case "boolean": return false
    case "enum": return schema.values[0]
    case "array": return []
    case "object": return Object.fromEntries(schema.properties.flatMap((property) => {
      const value = initialValue(property.schema, property.optional)
      return value === undefined ? [] : [[property.name, value]]
    }))
    case "discriminatedUnion": return schema.variants[0]
      ? initialValue(schema.variants[0].schema)
      : undefined
    case "json": return ""
  }
}

export function selectedVariant(schema: DiscriminatedUnionSchema, value: JsonValue | undefined) {
  const discriminator = value && typeof value === "object" && !Array.isArray(value)
    ? value[schema.discriminator]
    : undefined
  if (typeof discriminator !== "string" && typeof discriminator !== "number" && typeof discriminator !== "boolean") {
    return undefined
  }
  return schema.variants.find((variant) => variant.values.includes(discriminator))
}

export function materialize(
  schema: TypeSchema,
  value: JsonValue | undefined,
  optional: boolean,
): JsonValue | undefined {
  if ((value === undefined || value === "") && optional) return undefined
  switch (schema.kind) {
    case "string": {
      if (typeof value !== "string") throw new TypeError(`Expected ${schema.label}`)
      return value
    }
    case "number": {
      const parsed = typeof value === "number" ? value : Number(value)
      if (!Number.isFinite(parsed)) throw new TypeError(`Expected ${schema.label}`)
      return parsed
    }
    case "boolean": return Boolean(value)
    case "enum": {
      if (!schema.values.some((candidate) => candidate === value)) {
        throw new TypeError(`Expected one of ${schema.values.join(", ")}`)
      }
      return value
    }
    case "array": {
      const item = (candidate: JsonValue): JsonValue => {
        const result = materialize(schema.item, candidate, false)
        if (result === undefined) throw new TypeError(`Expected ${schema.item.label}`)
        return result
      }
      if (Array.isArray(value)) return value.map(item)
      const text = String(value ?? "").trim()
      if (!text) return []
      if (text.startsWith("[")) {
        const parsed = JSON.parse(text) as JsonValue
        if (!Array.isArray(parsed)) throw new TypeError(`Expected an array for ${schema.label}`)
        return parsed.map(item)
      }
      return text.split(/[,\n]/).map((value) => item(value.trim()))
    }
    case "object": {
      const source = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, JsonValue>
        : {}
      return Object.fromEntries(schema.properties.flatMap((property) => {
        const result = materialize(property.schema, source[property.name], property.optional)
        return result === undefined ? [] : [[property.name, result]]
      }))
    }
    case "discriminatedUnion": {
      const variant = selectedVariant(schema, value)
      if (!variant) throw new TypeError(`Expected a valid ${schema.discriminator} for ${schema.label}`)
      return materialize(variant.schema, value, optional)
    }
    case "json": {
      if (typeof value !== "string") return value
      return value.trim() ? JSON.parse(value) as JsonValue : undefined
    }
  }
}

export function selectDiscriminatedVariant(
  schema: DiscriminatedUnionSchema,
  value: JsonValue | undefined,
  discriminator: string | number | boolean,
): JsonValue {
  const variant = schema.variants.find((candidate) => candidate.values.includes(discriminator))
  if (!variant) throw new TypeError(`Expected a valid ${schema.discriminator} for ${schema.label}`)
  const initial = initialValue(variant.schema)
  const current = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  const preserved = Object.fromEntries(variant.schema.properties.flatMap((property) => {
    if (property.name === schema.discriminator || !(property.name in current)) return []
    try {
      materialize(property.schema, current[property.name], property.optional)
      return [[property.name, current[property.name]!]]
    } catch {
      return []
    }
  }))
  return {
    ...(initial && typeof initial === "object" && !Array.isArray(initial) ? initial : {}),
    ...preserved,
    [schema.discriminator]: discriminator,
  }
}

export function materializedRequest(operation: ProviderOperationSchema, request: JsonValue): JsonValue {
  const source = request && typeof request === "object" && !Array.isArray(request)
    ? request as Record<string, JsonValue>
    : undefined
  const streamingChunks = operation.id === "synthesize" && Array.isArray(source?.text)
    ? source.text.map((chunk) => String(chunk))
    : undefined
  if (streamingChunks) {
    for (const [name, expected] of Object.entries(operation.streamingText?.constraints ?? {})) {
      if (source?.[name] !== expected) {
        throw new TypeError(`Streaming text requires ${name} to be ${String(expected)}`)
      }
    }
  }
  const value = materialize(
    operation.request,
    streamingChunks ? { ...source, text: streamingChunks[0] ?? "" } : request,
    false,
  )
  if (value === undefined) throw new TypeError("The provider request is required")
  if (!streamingChunks || !value || typeof value !== "object" || Array.isArray(value)) return value
  return { ...value, text: streamingChunks }
}
