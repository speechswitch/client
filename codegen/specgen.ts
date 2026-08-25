import path from "node:path";
import {
  API,
  SymbolFlags,
  TypeFlags,
  type Checker,
  type JSDocTagInfo,
  type Project,
  type Symbol,
  type Type,
} from "typescript/unstable/sync";
import type { SourceFile } from "typescript/unstable/ast";
import type {
  SchemaConstraints,
  SchemaField,
  SchemaType,
  SpeechSpec,
  TtsProviderSpec,
} from "./spec-model.ts";

export interface ProviderSpecSource {
  readonly id: string;
  readonly file: string;
}

export interface ExtractSpeechSpecOptions {
  readonly root: string;
  readonly tsconfig: string;
  readonly baseFile: string;
  readonly providers: readonly ProviderSpecSource[];
}

interface ExtractedField {
  readonly schema: SchemaField;
  readonly compilerType: Type;
}

interface Extractor {
  readonly checker: Checker;
  readonly project: Project;
  readonly root: string;
  readonly uint8ArraySymbol: Symbol;
  readonly asyncIterableSymbol: Symbol;
}

function fail(message: string): never {
  throw new TypeError(`Speech spec: ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function findNamedSymbol(extractor: Extractor, file: SourceFile, name: string): Symbol {
  const moduleSymbol = extractor.checker.getSymbolAtLocation(file);
  invariant(moduleSymbol, `${name} must be exported from ${path.relative(extractor.root, file.fileName)}`);
  const symbol = extractor.checker.getMemberInModuleExports(moduleSymbol, name);
  invariant(symbol, `${name} must be exported from ${path.relative(extractor.root, file.fileName)}`);
  return symbol;
}

function resolveGlobalTypeSymbol(checker: Checker, name: string): Symbol {
  const symbol = checker.resolveName(name, SymbolFlags.Type);
  invariant(symbol && !checker.isUnknownSymbol(symbol), `could not resolve global type ${name}`);
  return symbol;
}

function sourceFile(extractor: Extractor, fileName: string): SourceFile {
  const file = extractor.project.program.getSourceFile(fileName);
  invariant(file, `${path.relative(extractor.root, fileName)} is not included by the project`);
  return file;
}

function documentation(extractor: Extractor, symbol: Symbol): string {
  return extractor.checker.getDocumentationCommentOfSymbol(symbol).trim();
}

function tagText(tag: JSDocTagInfo): string {
  return tag.text?.trim() ?? "";
}

function annotations(extractor: Extractor, symbol: Symbol): Pick<SchemaField, "constraints" | "deprecated" | "examples"> {
  const constraints: { minimum?: number; maximum?: number; pattern?: string } = {};
  const examples: string[] = [];
  let deprecated: string | undefined;
  for (const tag of extractor.checker.getJsDocTagsOfSymbol(symbol)) {
    const text = tagText(tag);
    if (tag.name === "minimum" || tag.name === "maximum") {
      const value = Number(text);
      invariant(text && Number.isFinite(value), `${symbol.name} has an invalid @${tag.name} value`);
      constraints[tag.name] = value;
    } else if (tag.name === "pattern") {
      invariant(text, `${symbol.name} has an empty @pattern`);
      try {
        new RegExp(text);
      } catch {
        fail(`${symbol.name} has an invalid @pattern`);
      }
      constraints.pattern = text;
    } else if (tag.name === "deprecated") {
      deprecated = text || "Deprecated";
    } else if (tag.name === "example") {
      if (text) examples.push(text);
    }
  }
  invariant(
    constraints.minimum === undefined || constraints.maximum === undefined || constraints.minimum <= constraints.maximum,
    `${symbol.name} has @minimum greater than @maximum`,
  );
  return {
    ...(Object.keys(constraints).length ? { constraints } : {}),
    ...(deprecated ? { deprecated } : {}),
    ...(examples.length ? { examples } : {}),
  };
}

function propertyTypes(type: Type, optional: boolean): readonly Type[] {
  const types = type.isUnionType() ? type.getTypes() : [type];
  return optional ? types.filter((part) => !(part.flags & TypeFlags.Undefined)) : types;
}

function schemaType(extractor: Extractor, type: Type, stack: ReadonlySet<number> = new Set()): SchemaType {
  const display = extractor.checker.typeToString(type);
  if (type.isTypeReference()) {
    const target = type.getTarget().getSymbol();
    const arguments_ = extractor.checker.getTypeArguments(type);
    if (target?.id === extractor.uint8ArraySymbol.id) return { kind: "bytes" };
    if (target?.id === extractor.asyncIterableSymbol.id) {
      const item = arguments_[0];
      invariant(item, `could not resolve ${display}`);
      return { kind: "async-iterable", items: schemaType(extractor, item, stack) };
    }
    if (extractor.checker.isArrayType(type)) {
      const item = arguments_[0];
      invariant(item, `could not resolve array element type for ${display}`);
      return { kind: "array", items: schemaType(extractor, item, stack) };
    }
  }
  if (type.isUnionType()) {
    const parts = type.getTypes();
    if (parts.length === 1) return schemaType(extractor, parts[0]!, stack);
    return { kind: "union", anyOf: parts.map((part) => schemaType(extractor, part, stack)) };
  }
  if (type.isLiteralType()) {
    const value = type.value;
    invariant(typeof value !== "bigint", `bigint literals are not portable: ${display}`);
    return { kind: "literal", value };
  }
  if (type.flags & TypeFlags.String) return { kind: "string" };
  if (type.flags & TypeFlags.Number) return { kind: "number" };
  if (type.flags & TypeFlags.Boolean) return { kind: "boolean" };
  if (type.flags & TypeFlags.BigInt) return { kind: "bigint" };
  if (type.flags & TypeFlags.Null) return { kind: "literal", value: null };
  if (type.flags & TypeFlags.Undefined) fail("undefined is only supported through optional properties");
  if (type.isObjectType()) {
    invariant(!stack.has(type.id), `recursive object types are not supported: ${display}`);
    const nextStack = new Set(stack).add(type.id);
    const fields = extractor.checker.getPropertiesOfType(type)
      .map((property) => extractField(extractor, property, false, nextStack).schema)
      .sort((left, right) => left.name.localeCompare(right.name));
    invariant(fields.length, `unsupported object type ${display}`);
    return { kind: "object", fields };
  }
  fail(`unsupported type ${display}`);
}

function constraintsMatchType(field: SchemaField): void {
  const constraints = field.constraints;
  if (!constraints) return;
  const accepts = (type: SchemaType, primitive: "number" | "string"): boolean => {
    if (type.kind === primitive) return true;
    if (type.kind === "literal") return typeof type.value === primitive;
    return type.kind === "union" && type.anyOf.every((part) => accepts(part, primitive));
  };
  invariant(
    (constraints.minimum === undefined && constraints.maximum === undefined) || accepts(field.type, "number"),
    `${field.name} uses numeric bounds on a non-number type`,
  );
  invariant(
    constraints.pattern === undefined || accepts(field.type, "string"),
    `${field.name} uses @pattern on a non-string type`,
  );
}

function extractField(
  extractor: Extractor,
  symbol: Symbol,
  requireDocumentation: boolean,
  stack?: ReadonlySet<number>,
): ExtractedField {
  const compilerType = extractor.checker.getTypeOfSymbol(symbol);
  invariant(compilerType, `could not resolve field ${symbol.name}`);
  const optional = Boolean(symbol.flags & SymbolFlags.Optional);
  const docs = documentation(extractor, symbol);
  invariant(!requireDocumentation || docs, `public base field ${symbol.name} must have documentation`);
  const parts = propertyTypes(compilerType, optional);
  invariant(parts.length, `${symbol.name} cannot contain only undefined`);
  const normalizedType = parts.length === 1
    ? schemaType(extractor, parts[0]!, stack)
    : { kind: "union", anyOf: parts.map((part) => schemaType(extractor, part, stack)) } satisfies SchemaType;
  const schema: SchemaField = {
    name: symbol.name,
    optional,
    documentation: docs,
    typeScriptType: extractor.checker.typeToString(compilerType),
    type: normalizedType,
    ...annotations(extractor, symbol),
  };
  constraintsMatchType(schema);
  return { schema, compilerType };
}

function constraintsAreNarrower(provider: SchemaConstraints | undefined, base: SchemaConstraints | undefined): boolean {
  if (!base) return true;
  if (base.minimum !== undefined && (provider?.minimum === undefined || provider.minimum < base.minimum)) return false;
  if (base.maximum !== undefined && (provider?.maximum === undefined || provider.maximum > base.maximum)) return false;
  if (base.pattern !== undefined && provider?.pattern !== base.pattern) return false;
  return true;
}

function extractProviderRequest(
  extractor: Extractor,
  type: Type,
  providerId: string,
  baseFields: ReadonlyMap<string, ExtractedField>,
): SchemaType {
  if (type.isUnionType()) {
    const parts = type.getTypes();
    invariant(!parts.some((part) => part.flags & TypeFlags.Undefined), `provider ${providerId} request cannot be optional`);
    return { kind: "union", anyOf: parts.map((part) => extractProviderRequest(extractor, part, providerId, baseFields)) };
  }
  invariant(type.isObjectType(), `provider ${providerId} request must be an object or a union of objects`);
  invariant(!extractor.checker.getIndexInfosOfType(type).length, `provider ${providerId} must list normalized fields explicitly`);
  const fields = extractor.checker.getPropertiesOfType(type).flatMap((field) => {
    const compilerType = extractor.checker.getTypeOfSymbol(field);
    invariant(compilerType, `could not resolve provider ${providerId} field ${field.name}`);
    const parts = propertyTypes(compilerType, Boolean(field.flags & SymbolFlags.Optional));
    if (parts.every((part) => part.flags & TypeFlags.Never)) return [];
    const base = baseFields.get(field.name);
    invariant(base, `provider ${providerId} introduces unknown field ${field.name}`);
    const extracted = extractField(extractor, field, false);
    invariant(
      extractor.checker.isTypeAssignableTo(extracted.compilerType, base.compilerType),
      `provider ${providerId} field ${field.name} widens ${base.schema.typeScriptType} to ${extracted.schema.typeScriptType}`,
    );
    const constraints = base.schema.constraints || extracted.schema.constraints
      ? { ...base.schema.constraints, ...extracted.schema.constraints }
      : undefined;
    invariant(
      constraintsAreNarrower(constraints, base.schema.constraints),
      `provider ${providerId} field ${field.name} has constraints wider than the base field`,
    );
    return {
      ...extracted.schema,
      documentation: extracted.schema.documentation || base.schema.documentation,
      ...(constraints ? { constraints } : {}),
      ...(extracted.schema.deprecated || base.schema.deprecated
        ? { deprecated: extracted.schema.deprecated ?? base.schema.deprecated }
        : {}),
      ...(extracted.schema.examples || base.schema.examples
        ? { examples: extracted.schema.examples ?? base.schema.examples }
        : {}),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  invariant(fields.length, `provider ${providerId} request must contain at least one normalized field`);
  return { kind: "object", fields };
}

function extractProvider(
  extractor: Extractor,
  provider: ProviderSpecSource,
  baseFields: ReadonlyMap<string, ExtractedField>,
): TtsProviderSpec {
  const file = sourceFile(extractor, path.resolve(extractor.root, provider.file));
  const requestSymbol = findNamedSymbol(extractor, file, "TtsRequest");
  const requestType = extractor.checker.getDeclaredTypeOfSymbol(requestSymbol);
  const providerDocumentation = documentation(extractor, requestSymbol);
  return {
    id: provider.id,
    ...(providerDocumentation ? { documentation: providerDocumentation } : {}),
    request: extractProviderRequest(extractor, requestType, provider.id, baseFields),
  };
}

function diagnosticText(project: Project): string | undefined {
  const diagnostics = [
    ...project.program.getConfigFileParsingDiagnostics(),
    ...project.program.getProgramDiagnostics(),
    ...project.program.getSyntacticDiagnostics(),
    ...project.program.getSemanticDiagnostics(),
  ];
  if (!diagnostics.length) return undefined;
  return diagnostics.map((diagnostic) => {
    const location = diagnostic.fileName ? `${diagnostic.fileName}:${diagnostic.pos}` : "project";
    return `${location} TS${diagnostic.code}: ${diagnostic.text}`;
  }).join("\n");
}

export function extractSpeechSpec(options: ExtractSpeechSpecOptions): SpeechSpec {
  const root = path.resolve(options.root);
  const tsconfig = path.resolve(root, options.tsconfig);
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [tsconfig] });
    try {
      const project = snapshot.getProject(tsconfig) ?? snapshot.getProjects()[0];
      invariant(project, `could not open ${path.relative(root, tsconfig)}`);
      const diagnostics = diagnosticText(project);
      invariant(!diagnostics, `TypeScript project contains errors:\n${diagnostics}`);
      const extractor: Extractor = {
        checker: project.checker,
        project,
        root,
        uint8ArraySymbol: resolveGlobalTypeSymbol(project.checker, "Uint8Array"),
        asyncIterableSymbol: resolveGlobalTypeSymbol(project.checker, "AsyncIterable"),
      };
      const baseFile = sourceFile(extractor, path.resolve(root, options.baseFile));
      const baseSymbol = findNamedSymbol(extractor, baseFile, "TtsRequest");
      const baseType = extractor.checker.getDeclaredTypeOfSymbol(baseSymbol);
      invariant(!extractor.checker.getIndexInfosOfType(baseType).length, "TtsRequest must list normalized fields explicitly");
      const extractedBaseFields = extractor.checker.getPropertiesOfType(baseType)
        .map((field) => extractField(extractor, field, true))
        .sort((left, right) => left.schema.name.localeCompare(right.schema.name));
      const baseFields = new Map(extractedBaseFields.map((field) => [field.schema.name, field]));
      const providerSources = [...options.providers];
      const duplicateProvider = providerSources.find((provider, index) =>
        providerSources.findIndex((candidate) => candidate.id === provider.id) !== index);
      invariant(!duplicateProvider, `duplicate provider id ${duplicateProvider?.id}`);
      const providers = providerSources
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((provider) => extractProvider(extractor, provider, baseFields));
      return {
        tts: {
          request: {
            name: "TtsRequest",
            documentation: documentation(extractor, baseSymbol),
            fields: extractedBaseFields.map(({ schema }) => schema),
          },
          providers,
        },
      };
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}
