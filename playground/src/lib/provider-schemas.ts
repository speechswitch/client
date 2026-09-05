import type { SchemaType, SpeechSpec } from "../../../codegen/spec-model.ts"
import type {
  ObjectSchema,
  PropertySchema,
  ProviderSchema,
  Scalar,
  TypeSchema,
} from "./provider-schema.ts"

function literalValues(type: SchemaType): Scalar[] | undefined {
  const alternatives = type.kind === "union" ? type.anyOf : [type]
  const values = alternatives.flatMap((alternative) => alternative.kind === "boolean" ? [false, true] :
    alternative.kind === "literal" && alternative.value !== null ? [alternative.value] : [undefined])
  return values.every((value) => value !== undefined) ? values as Scalar[] : undefined
}

type ObjectType = Extract<SchemaType, { kind: "object" }>

function objectAlternatives(alternatives: readonly ObjectType[], used: readonly string[] = []): TypeSchema {
  const seen = new Set<string>()
  alternatives = alternatives.filter((alternative) => {
    const key = JSON.stringify(objectSchema(alternative))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (alternatives.length === 1) return objectSchema(alternatives[0]!)
  const names = [...new Set(alternatives.flatMap(({ fields }) => fields.map(({ name }) => name)))]
  // Model is the primary capability selector; other literal fields refine its variants.
  const priority = ["model", "format", "sampleRateHz"]
  names.sort((a, b) => (priority.includes(a) ? priority.indexOf(a) : priority.length)
    - (priority.includes(b) ? priority.indexOf(b) : priority.length))
  for (const name of names) {
    if (used.includes(name)) continue
    const fields = alternatives.map(({ fields }) => fields.find((field) => field.name === name))
    const values = fields.map((field) => !field ? [] : field.type.kind === "boolean" ? [false, true] : literalValues(field.type))
    if (values.some((value) => value === undefined)) {
      const omitted = alternatives.filter((_alternative, index) => !fields[index] || fields[index]!.optional)
      const present = alternatives.filter((_alternative, index) => fields[index])
      if (!omitted.length || !present.length || (omitted.length === alternatives.length && present.length === alternatives.length)) continue
      return { kind: "discriminatedUnion", discriminator: name, variants: [
        { values: [], omitted: true, schema: objectAlternatives(omitted, [...used, name]) },
        { values: [], present: true, schema: objectAlternatives(present, [...used, name]) },
      ] }
    }
    const choices: (Scalar | undefined)[] = [...new Set(values.flatMap((value) => value!))]
    if (fields.some((field) => !field || field.optional)) choices.unshift(undefined)
    const groups = choices.map((choice) => ({
      choice,
      alternatives: alternatives.filter((_alternative, index) => choice === undefined
        ? !fields[index] || fields[index]!.optional
        : values[index]!.includes(choice)),
    }))
    if (!groups.some((group) => group.alternatives.length < alternatives.length)) continue
    const variants: Extract<TypeSchema, { kind: "discriminatedUnion" }>["variants"] = []
    for (const group of groups) {
      const schema = objectAlternatives(group.alternatives, [...used, name])
      const previous = variants.find((variant) => JSON.stringify(variant.schema) === JSON.stringify(schema))
      if (previous) {
        if (group.choice === undefined) previous.omitted = true
        else previous.values.push(group.choice)
      } else {
        variants.push({ values: group.choice === undefined ? [] : [group.choice], ...(group.choice === undefined ? { omitted: true } : {}), schema })
      }
    }
    return { kind: "discriminatedUnion", discriminator: name, variants }
  }
  return { kind: "union", variants: alternatives.map(objectSchema) }
}

function objectSchema(type: Extract<SchemaType, { kind: "object" }>): ObjectSchema {
  return {
    kind: "object",
    ...(type.forbidden?.length ? { forbidden: [...type.forbidden] } : {}),
    properties: type.fields.map((field): PropertySchema => ({
      name: field.name,
      optional: field.optional,
      ...(field.documentation ? { description: field.documentation } : {}),
      ...(field.default !== undefined ? { default: field.default } : {}),
      schema: typeSchema(field.type),
    })),
  }
}

function typeSchema(type: SchemaType): TypeSchema {
  switch (type.kind) {
    case "string": return { kind: "string" }
    case "number": return { kind: "number" }
    case "boolean": return { kind: "boolean" }
    case "literal": return type.value === null
      ? { kind: "json" }
      : { kind: "enum", values: [type.value] }
    case "array": return { kind: "array", item: typeSchema(type.items) }
    case "async-iterable": return { kind: "array", item: typeSchema(type.items) }
    case "object": return objectSchema(type)
    case "union": {
      const values = literalValues(type)
      if (values) return { kind: "enum", values }

      if (type.anyOf.every((alternative) => alternative.kind === "object")) {
        return objectAlternatives(type.anyOf)
      }

      return { kind: "union", variants: type.anyOf.map(typeSchema) }
    }
    case "bigint":
    case "bytes":
      return { kind: "json" }
  }
}

function requestBranches(request: SchemaType): { staticRequest: ObjectType[]; streamingRequest: ObjectType[] } {
  const alternatives = request.kind === "union" ? request.anyOf : [request]
  const objects = alternatives.filter((alternative): alternative is Extract<SchemaType, { kind: "object" }> =>
    alternative.kind === "object")
  const branches = (kind: "string" | "async-iterable") => objects.filter(({ fields }) => fields.some(({ name, type }) =>
    name === "text" && (type.kind === "union" ? type.anyOf : [type]).some((type) => type.kind === kind)))
    .map((object): ObjectType => ({ ...object, fields: object.fields.map((field) => field.name === "text"
      ? { ...field, type: { kind: "string" } } : field) }))
  const staticRequest = branches("string")
  if (!staticRequest.length) throw new TypeError("Provider TtsRequest must contain a static string text branch")
  return { staticRequest, streamingRequest: branches("async-iterable") }
}

export function providerSchemasFromSpeechSpec(spec: SpeechSpec): ProviderSchema[] {
  return spec.tts.providers.map((provider) => {
    const branches = requestBranches(provider.request)
    return {
      id: provider.id,
      request: objectAlternatives(branches.staticRequest),
      ...(branches.streamingRequest.length ? {
        streamingText: { request: objectAlternatives(branches.streamingRequest) },
      } : {}),
    } satisfies ProviderSchema
  })
}
