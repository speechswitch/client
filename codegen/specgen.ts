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

function schemaTypeFromParts(
  extractor: Extractor,
  parts: readonly Type[],
  stack: ReadonlySet<number> = new Set(),
): SchemaType {
  if (parts.length === 1) return schemaType(extractor, parts[0]!, stack);
  return { kind: "union", anyOf: parts.map((part) => schemaType(extractor, part, stack)) };
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
    return schemaTypeFromParts(extractor, type.getTypes(), stack);
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
      .flatMap((property) => {
        const field = extractField(extractor, property, false, nextStack);
        return field ? [field] : [];
      })
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
): SchemaField | undefined {
  const compilerType = extractor.checker.getTypeOfSymbol(symbol);
  invariant(compilerType, `could not resolve field ${symbol.name}`);
  const optional = Boolean(symbol.flags & SymbolFlags.Optional);
  const docs = documentation(extractor, symbol);
  invariant(!requireDocumentation || docs, `public base field ${symbol.name} must have documentation`);
  const parts = propertyTypes(compilerType, optional);
  if (!parts.length || parts.every((part) => part.flags & TypeFlags.Never)) return undefined;
  const normalizedType = schemaTypeFromParts(extractor, parts, stack);
  const schema: SchemaField = {
    name: symbol.name,
    optional,
    documentation: docs,
    typeScriptType: extractor.checker.typeToString(compilerType),
    type: normalizedType,
    ...annotations(extractor, symbol),
  };
  constraintsMatchType(schema);
  return schema;
}

function constraintsAreNarrower(provider: SchemaConstraints | undefined, base: SchemaConstraints | undefined): boolean {
  if (!base) return true;
  if (base.minimum !== undefined && (provider?.minimum === undefined || provider.minimum < base.minimum)) return false;
  if (base.maximum !== undefined && (provider?.maximum === undefined || provider.maximum > base.maximum)) return false;
  if (base.pattern !== undefined && provider?.pattern !== base.pattern) return false;
  return true;
}

interface ComparisonContext {
  readonly providerId: string;
  readonly path: string;
  readonly providerType: string;
  readonly baseType: string;
  readonly errors: string[];
}

function mismatch(context: ComparisonContext): void {
  context.errors.push(
    `provider ${context.providerId} field ${context.path} widens ${context.baseType} to ${context.providerType}`,
  );
}

function compareSchema(provider: SchemaType, base: SchemaType, context: ComparisonContext): SchemaType {
  if (provider.kind === "union") {
    return { kind: "union", anyOf: provider.anyOf.map((part) => compareSchema(part, base, context)) };
  }
  if (base.kind === "union") {
    for (const part of base.anyOf) {
      const errors: string[] = [];
      const schema = compareSchema(provider, part, { ...context, errors });
      if (!errors.length) return schema;
    }
    mismatch(context);
    return provider;
  }
  if (provider.kind === "literal") {
    const matches = base.kind === "literal"
      ? provider.value === base.value
      : provider.value !== null && base.kind === typeof provider.value;
    if (!matches) mismatch(context);
    return provider;
  }
  if (provider.kind !== base.kind) {
    mismatch(context);
    return provider;
  }
  if (
    (provider.kind === "array" && base.kind === "array")
    || (provider.kind === "async-iterable" && base.kind === "async-iterable")
  ) {
    return { kind: provider.kind, items: compareSchema(provider.items, base.items, context) };
  }
  if (provider.kind === "object" && base.kind === "object") {
    const baseFields = new Map(base.fields.map((field) => [field.name, field]));
    const fields: SchemaField[] = [];
    for (const field of provider.fields) {
      const path = context.path ? `${context.path}.${field.name}` : field.name;
      const baseField = baseFields.get(field.name);
      if (!baseField) {
        context.errors.push(`provider ${context.providerId} introduces unknown field ${path}`);
        continue;
      }
      const fieldContext: ComparisonContext = {
        ...context,
        path,
        providerType: field.typeScriptType,
        baseType: baseField.typeScriptType,
      };
      if (!baseField.optional && field.optional) mismatch(fieldContext);
      const type = compareSchema(field.type, baseField.type, fieldContext);
      const constraints = baseField.constraints || field.constraints
        ? { ...baseField.constraints, ...field.constraints }
        : undefined;
      if (!constraintsAreNarrower(constraints, baseField.constraints)) {
        context.errors.push(`provider ${context.providerId} field ${path} has constraints wider than the base field`);
      }
      fields.push({
        ...field,
        type,
        documentation: field.documentation || baseField.documentation,
        ...(constraints ? { constraints } : {}),
        ...(field.deprecated || baseField.deprecated
          ? { deprecated: field.deprecated ?? baseField.deprecated }
          : {}),
        ...(field.examples || baseField.examples
          ? { examples: field.examples ?? baseField.examples }
          : {}),
      });
    }
    return { kind: "object", fields };
  }
  return provider;
}

function normalizeProviderRequest(extractor: Extractor, type: Type, providerId: string): SchemaType {
  const parts = type.isUnionType() ? type.getTypes() : [type];
  invariant(!parts.some((part) => part.flags & TypeFlags.Undefined), `provider ${providerId} request cannot be optional`);
  for (const part of parts) {
    invariant(part.isObjectType(), `provider ${providerId} request must be an object or a union of objects`);
    invariant(!extractor.checker.getIndexInfosOfType(part).length, `provider ${providerId} must list normalized fields explicitly`);
  }
  return schemaType(extractor, type);
}

function extractProvider(
  extractor: Extractor,
  provider: ProviderSpecSource,
  baseRequest: Extract<SchemaType, { readonly kind: "object" }>,
  errors: string[],
): TtsProviderSpec {
  const file = sourceFile(extractor, path.resolve(extractor.root, provider.file));
  const requestSymbol = findNamedSymbol(extractor, file, "TtsRequest");
  const requestType = extractor.checker.getDeclaredTypeOfSymbol(requestSymbol);
  const providerDocumentation = documentation(extractor, requestSymbol);
  const request = normalizeProviderRequest(extractor, requestType, provider.id);
  const schema = compareSchema(request, baseRequest, {
    providerId: provider.id,
    path: "",
    providerType: extractor.checker.typeToString(requestType),
    baseType: "TtsRequest",
    errors,
  });
  return {
    id: provider.id,
    ...(providerDocumentation ? { documentation: providerDocumentation } : {}),
    request: schema,
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
      invariant(baseType.isObjectType(), "TtsRequest must be an object");
      invariant(!extractor.checker.getIndexInfosOfType(baseType).length, "TtsRequest must list normalized fields explicitly");
      const baseFields = extractor.checker.getPropertiesOfType(baseType)
        .flatMap((field) => {
          const extracted = extractField(extractor, field, true, new Set([baseType.id]));
          return extracted ? [extracted] : [];
        })
        .sort((left, right) => left.name.localeCompare(right.name));
      invariant(baseFields.length, "TtsRequest must contain at least one normalized field");
      const baseRequest = { kind: "object", fields: baseFields } as const;
      const providerSources = [...options.providers];
      const duplicateProvider = providerSources.find((provider, index) =>
        providerSources.findIndex((candidate) => candidate.id === provider.id) !== index);
      invariant(!duplicateProvider, `duplicate provider id ${duplicateProvider?.id}`);
      const errors: string[] = [];
      const providers = providerSources
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((provider) => extractProvider(extractor, provider, baseRequest, errors));
      invariant(!errors.length, errors.join("\n"));
      return {
        tts: {
          request: {
            name: "TtsRequest",
            documentation: documentation(extractor, baseSymbol),
            fields: baseRequest.fields,
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
