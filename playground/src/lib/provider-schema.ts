export type Scalar = string | number | boolean
export type JsonValue = null | Scalar | JsonValue[] | { [key: string]: JsonValue }

export type TypeSchema =
  | { kind: "string"; label: string }
  | { kind: "number"; label: string }
  | { kind: "boolean"; label: string }
  | { kind: "enum"; label: string; values: Scalar[] }
  | { kind: "array"; label: string; item: TypeSchema }
  | { kind: "object"; label: string; properties: PropertySchema[] }
  | { kind: "json"; label: string }

export interface PropertySchema {
  name: string
  optional: boolean
  description?: string
  schema: TypeSchema
}

export type ProviderOperation = "synthesize" | "synthesizeWithTimestamps"

export interface ProviderOperationSchema {
  id: ProviderOperation
  label: string
  description?: string
  request: TypeSchema
}

export interface ProviderSchema {
  id: string
  label: string
  operations: ProviderOperationSchema[]
}
