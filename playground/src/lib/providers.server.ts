import { synthesize, synthesizeWithTimestamps } from "../../../sdk/index.ts"

import { analyzeProviders } from "./analyze-providers.server"
import type { ProviderOperation, ProviderSchema } from "./provider-schema"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type ProviderOutput =
  | { type: "audio"; base64: string; contentType: string }
  | { type: "event"; value: JsonValue }
  | { type: "error"; message: string; stack?: string }

const schemas = analyzeProviders()
const dynamicSynthesize = synthesize as unknown as (provider: string, request: unknown) => unknown
const dynamicSynthesizeWithTimestamps = synthesizeWithTimestamps as unknown as (
  provider: string,
  request: unknown,
) => unknown

export function providerSchemas(): ProviderSchema[] {
  return schemas
}

function bytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
}

function contentType(value: Uint8Array): string {
  if (value[0] === 0x52 && value[1] === 0x49 && value[2] === 0x46 && value[3] === 0x46) return "audio/wav"
  if (value[0] === 0x4f && value[1] === 0x67 && value[2] === 0x67 && value[3] === 0x53) return "audio/ogg"
  if (value[0] === 0x66 && value[1] === 0x4c && value[2] === 0x61 && value[3] === 0x43) return "audio/flac"
  if (value[0] === 0x1a && value[1] === 0x45 && value[2] === 0xdf && value[3] === 0xa3) return "audio/webm"
  if (value[4] === 0x66 && value[5] === 0x74 && value[6] === 0x79 && value[7] === 0x70) return "audio/mp4"
  return "audio/mpeg"
}

function serializable(value: unknown): JsonValue {
  const seen = new WeakSet<object>()
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString()
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        stack: item.stack,
        ...("cause" in item ? { cause: item.cause } : {}),
      }
    }
    if (item instanceof Map) return Object.fromEntries(item)
    if (item instanceof Set) return [...item]
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[Circular]"
      seen.add(item)
    }
    return item
  })
  return json === undefined ? String(value) : JSON.parse(json) as JsonValue
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
}

async function* inspect(value: unknown, audio: Uint8Array[]): AsyncGenerator<ProviderOutput> {
  value = await value

  const binary = bytes(value)
  if (binary) {
    audio.push(binary)
    return
  }

  if (value instanceof Blob) {
    audio.push(new Uint8Array(await value.arrayBuffer()))
    return
  }

  if (isAsyncIterable(value)) {
    for await (const item of value) yield* inspect(item, audio)
    return
  }

  if (value && typeof value === "object" && "audio" in value) {
    const result = value as Record<string, unknown>
    const audioBytes = bytes(result.audio)
    if (audioBytes) audio.push(audioBytes)
    const rest = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "audio"))
    if (Object.keys(rest).length) yield { type: "event", value: serializable(rest) }
    return
  }

  yield { type: "event", value: serializable(value) }
}

export async function* runProvider(
  provider: string,
  operation: ProviderOperation,
  request: unknown,
): AsyncGenerator<ProviderOutput> {
  const schema = schemas.find(({ id }) => id === provider)
  if (!schema?.operations.some(({ id }) => id === operation)) {
    yield { type: "error", message: `Unknown provider operation: ${provider}.${operation}` }
    return
  }

  const audio: Uint8Array[] = []
  try {
    const result = operation === "synthesize"
      ? dynamicSynthesize(provider, request)
      : dynamicSynthesizeWithTimestamps(provider, request)
    yield* inspect(result, audio)
    if (audio.length) {
      const size = audio.reduce((total, chunk) => total + chunk.byteLength, 0)
      const joined = new Uint8Array(size)
      let offset = 0
      for (const chunk of audio) {
        joined.set(chunk, offset)
        offset += chunk.byteLength
      }
      yield {
        type: "audio",
        base64: Buffer.from(joined).toString("base64"),
        contentType: contentType(joined),
      }
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    yield { type: "error", message: error.message, stack: error.stack }
  }
}
