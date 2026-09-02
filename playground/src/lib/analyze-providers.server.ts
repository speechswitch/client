import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

import type {
  PropertySchema,
  ProviderOperation,
  ProviderOperationSchema,
  ProviderSchema,
  Scalar,
  TypeSchema,
} from "./provider-schema"

const repositoryRoot = existsSync(path.resolve(process.cwd(), "schemas/tsconfig.json"))
  ? process.cwd()
  : path.resolve(process.cwd(), "..")
const providersDirectory = path.join(repositoryRoot, "schemas/providers")

const operations: ReadonlyArray<{
  id: ProviderOperation
  exportName: string
  label: string
}> = [
  { id: "synthesize", exportName: "TtsRequest", label: "Synthesis" },
  {
    id: "synthesizeWithTimestamps",
    exportName: "TtsRequestWithTimestamps",
    label: "Synthesis with timestamps",
  },
]

function compactTypeLabel(checker: ts.TypeChecker, type: ts.Type): string {
  const label = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
  return label.length > 120 ? `${label.slice(0, 117)}...` : label
}

function withoutNullish(type: ts.Type): { type: ts.Type; optional: boolean } {
  if (!type.isUnion()) return { type, optional: false }
  const types = type.types.filter((part) => !(part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)))
  return {
    type: types.length === 1 ? types[0]! : type,
    optional: types.length !== type.types.length,
  }
}

function literal(type: ts.Type): Scalar | undefined {
  if (type.isStringLiteral() || type.isNumberLiteral()) return type.value
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return (type as ts.Type & { intrinsicName: string }).intrinsicName === "true"
  }
}

function propertyLiteralValues(
  checker: ts.TypeChecker,
  type: ts.Type,
  name: string,
  location: ts.Node,
): Scalar[] | undefined {
  const property = checker.getPropertyOfType(type, name)
  if (!property || property.flags & ts.SymbolFlags.Optional) return undefined
  const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? location
  const normalized = withoutNullish(checker.getTypeOfSymbolAtLocation(property, declaration))
  if (normalized.optional) return undefined
  const parts = normalized.type.isUnion() ? normalized.type.types : [normalized.type]
  const values = parts.map(literal)
  return values.every((value) => value !== undefined) ? values as Scalar[] : undefined
}

function discriminatedObjectUnion(
  checker: ts.TypeChecker,
  parts: readonly ts.Type[],
  location: ts.Node,
  seen: Set<ts.Type>,
  depth: number,
  label: string,
): TypeSchema | undefined {
  if (!parts.every((part) => part.flags & ts.TypeFlags.Object)) return undefined
  const candidates = checker.getPropertiesOfType(parts[0]!)
  for (const candidate of candidates) {
    const values = parts.map((part) => propertyLiteralValues(checker, part, candidate.name, location))
    if (values.some((part) => !part)) continue
    const flattened = values.flatMap((part) => part!)
    if (new Set(flattened.map((value) => `${typeof value}:${String(value)}`)).size !== flattened.length) continue
    const schemas = parts.map((part) => {
      const schema = schemaForType(checker, part, location, new Set(seen), depth + 1)
      return schema.kind === "object" ? schema : undefined
    })
    if (schemas.some((schema) => !schema)) continue
    return {
      kind: "discriminatedUnion",
      label,
      discriminator: candidate.name,
      variants: parts.map((_part, index) => ({ values: values[index]!, schema: schemas[index]! })),
    }
  }
}

function schemaForType(
  checker: ts.TypeChecker,
  input: ts.Type,
  location: ts.Node,
  seen = new Set<ts.Type>(),
  depth = 0,
): TypeSchema {
  const { type } = withoutNullish(input)
  const label = compactTypeLabel(checker, input)
  const unionParts = input.isUnion()
    ? input.types.filter((part) => !(part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)))
    : type.isUnion() ? type.types : undefined

  if (unionParts && unionParts.length > 1) {
    const discriminated = discriminatedObjectUnion(checker, unionParts, location, seen, depth, label)
    if (discriminated) return discriminated
    const values = unionParts.map(literal)
    if (values.every((value) => value !== undefined)) {
      return { kind: "enum", label, values: values as Scalar[] }
    }
    if (unionParts.every((part) => part.flags & ts.TypeFlags.StringLike)) return { kind: "string", label }
    if (unionParts.every((part) => part.flags & ts.TypeFlags.NumberLike)) return { kind: "number", label }
    if (unionParts.every((part) => part.flags & ts.TypeFlags.BooleanLike)) return { kind: "boolean", label }
  }

  const literalValue = literal(type)
  if (literalValue !== undefined) return { kind: "enum", label, values: [literalValue] }
  if (type.flags & ts.TypeFlags.StringLike) return { kind: "string", label }
  if (type.flags & ts.TypeFlags.NumberLike) return { kind: "number", label }
  if (type.flags & ts.TypeFlags.BooleanLike) return { kind: "boolean", label }

  if (checker.isTupleType(type) || checker.isArrayType(type)) {
    const item = checker.getIndexTypeOfType(type, ts.IndexKind.Number)
      ?? checker.getTypeArguments(type as ts.TypeReference)[0]
    return {
      kind: "array",
      label,
      item: item
        ? schemaForType(checker, item, location, seen, depth + 1)
        : { kind: "json", label: "unknown" },
    }
  }

  const indexed = checker.getIndexTypeOfType(type, ts.IndexKind.Number)
  if (indexed && /(?:Readonly)?Array|readonly \[/.test(label)) {
    return {
      kind: "array",
      label,
      item: schemaForType(checker, indexed, location, seen, depth + 1),
    }
  }

  if (depth < 4 && !seen.has(type)) {
    seen.add(type)
    const properties = checker.getPropertiesOfType(type)
      .filter((property) => {
        const declaration = property.valueDeclaration ?? property.declarations?.[0]
        return !declaration || !ts.isMethodSignature(declaration)
      })
      .map<PropertySchema>((property) => {
        const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? location
        const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration)
        const normalized = withoutNullish(propertyType)
        const documentation = ts.displayPartsToString(property.getDocumentationComment(checker))
        return {
          name: property.name,
          optional: Boolean(property.flags & ts.SymbolFlags.Optional) || normalized.optional,
          ...(documentation ? { description: documentation } : {}),
          schema: schemaForType(checker, propertyType, declaration, new Set(seen), depth + 1),
        }
      })
    if (properties.length) return { kind: "object", label, properties }
  }

  return { kind: "json", label }
}

function textRequestBranches(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node,
): { staticRequest: ts.Type; streamingRequest?: ts.Type } {
  if (!type.isUnion()) return { staticRequest: type }
  const staticRequest = type.types.find((part) => {
    const text = checker.getPropertyOfType(part, "text")
    if (!text) return false
    const declaration = text.valueDeclaration ?? text.declarations?.[0] ?? location
    return Boolean(withoutNullish(checker.getTypeOfSymbolAtLocation(text, declaration)).type.flags & ts.TypeFlags.StringLike)
  }) ?? type
  const streamingRequest = type.types.find((part) => {
    const text = checker.getPropertyOfType(part, "text")
    if (!text) return false
    const declaration = text.valueDeclaration ?? text.declarations?.[0] ?? location
    return !Boolean(withoutNullish(checker.getTypeOfSymbolAtLocation(text, declaration)).type.flags & ts.TypeFlags.StringLike)
  })
  return { staticRequest, ...(streamingRequest ? { streamingRequest } : {}) }
}

function literalConstraints(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node,
): Record<string, Scalar> {
  return Object.fromEntries(checker.getPropertiesOfType(type).flatMap((property) => {
    if (property.name === "text" || property.flags & ts.SymbolFlags.Optional) return []
    const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? location
    const value = literal(withoutNullish(checker.getTypeOfSymbolAtLocation(property, declaration)).type)
    return value === undefined ? [] : [[property.name, value]]
  }))
}

function providerSources(): Array<{ id: string; file: string }> {
  return readdirSync(providersDirectory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      return [{ id: entry.name.slice(0, -3), file: path.join(providersDirectory, entry.name) }]
    }
    const index = path.join(providersDirectory, entry.name, "index.ts")
    return entry.isDirectory() && existsSync(index) ? [{ id: entry.name, file: index }] : []
  }).sort((left, right) => left.id.localeCompare(right.id))
}

function program(): ts.Program {
  const configPath = path.join(repositoryRoot, "schemas/tsconfig.json")
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
}

function title(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function analyzeProviders(): ProviderSchema[] {
  const sourceProgram = program()
  const checker = sourceProgram.getTypeChecker()
  return providerSources().flatMap(({ id, file }): ProviderSchema[] => {
    const source = sourceProgram.getSourceFile(file)
    if (!source) throw new TypeError(`Could not load provider schema ${file}`)
    const module = checker.getSymbolAtLocation(source)
    if (!module) return []
    const exports = new Map(checker.getExportsOfModule(module).map((symbol) => [symbol.name, symbol]))
    const providerOperations = operations.flatMap(({ id: operationId, exportName, label }) => {
      const exported = exports.get(exportName)
      if (!exported) return []
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
      const declaration = symbol.declarations?.[0]
      if (!declaration) return []
      const declared = checker.getDeclaredTypeOfSymbol(symbol)
      const branches = operationId === "synthesize"
        ? textRequestBranches(checker, declared, declaration)
        : { staticRequest: declared }
      const description = ts.displayPartsToString(symbol.getDocumentationComment(checker))
      return [{
        id: operationId,
        label,
        ...(description ? { description } : {}),
        request: schemaForType(checker, branches.staticRequest, declaration),
        ...(branches.streamingRequest ? {
          streamingText: {
            constraints: literalConstraints(checker, branches.streamingRequest, declaration),
          },
        } : {}),
      } satisfies ProviderOperationSchema]
    })
    return providerOperations.length ? [{ id, label: title(id), operations: providerOperations }] : []
  })
}
