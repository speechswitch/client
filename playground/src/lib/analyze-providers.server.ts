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
    const values = unionParts.map(literal)
    if (values.every((value) => value !== undefined)) {
      return { kind: "enum", label, values: values as Scalar[] }
    }
    if (unionParts.every((part) => part.flags & ts.TypeFlags.StringLike)) return { kind: "string", label }
    if (unionParts.every((part) => part.flags & ts.TypeFlags.NumberLike)) return { kind: "number", label }
    if (unionParts.every((part) => part.flags & ts.TypeFlags.BooleanLike)) return { kind: "boolean", label }
  }

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

function staticTextRequest(checker: ts.TypeChecker, type: ts.Type, location: ts.Node): ts.Type {
  if (!type.isUnion()) return type
  return type.types.find((part) => {
    const text = checker.getPropertyOfType(part, "text")
    if (!text) return false
    const declaration = text.valueDeclaration ?? text.declarations?.[0] ?? location
    return Boolean(withoutNullish(checker.getTypeOfSymbolAtLocation(text, declaration)).type.flags & ts.TypeFlags.StringLike)
  }) ?? type
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
      const request = operationId === "synthesize"
        ? staticTextRequest(checker, declared, declaration)
        : declared
      const description = ts.displayPartsToString(symbol.getDocumentationComment(checker))
      return [{
        id: operationId,
        label,
        ...(description ? { description } : {}),
        request: schemaForType(checker, request, declaration),
      } satisfies ProviderOperationSchema]
    })
    return providerOperations.length ? [{ id, label: title(id), operations: providerOperations }] : []
  })
}
