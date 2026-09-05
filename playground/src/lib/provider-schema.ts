export type Scalar = string | number | boolean
export type JsonValue = null | Scalar | JsonValue[] | { [key: string]: JsonValue }

export interface ObjectSchema {
  kind: "object"
  properties: PropertySchema[]
}

export interface DiscriminatedUnionVariant {
  values: Scalar[]
  schema: ObjectSchema
}

export interface DiscriminatedUnionSchema {
  kind: "discriminatedUnion"
  discriminator: string
  variants: DiscriminatedUnionVariant[]
}

export type TypeSchema =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "enum"; values: Scalar[] }
  | { kind: "array"; item: TypeSchema }
  | ObjectSchema
  | DiscriminatedUnionSchema
  | { kind: "json" }

export interface PropertySchema {
  name: string
  optional: boolean
  description?: string
  default?: JsonValue
  schema: TypeSchema
}

export interface ProviderSchema {
  id: string
  request: TypeSchema
  streamingText?: { constraints: Record<string, Scalar> }
}
