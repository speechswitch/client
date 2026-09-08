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
import { arrayItemConstraints } from "./spec-model.ts";
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

function validateConstraintRange(name: string, constraints: SchemaConstraints): void {
  const items = arrayItemConstraints(constraints);
  if (items) validateConstraintRange(`${name} items`, items);
  invariant(constraints.minItems === undefined || constraints.maxItems === undefined || constraints.minItems <= constraints.maxItems,
    `${name} has @minItems greater than @maxItems`);
  invariant(constraints.minimum === undefined || constraints.maximum === undefined || constraints.minimum <= constraints.maximum,
    `${name} has @minimum greater than @maximum`);
  invariant(constraints.exclusiveMinimum === undefined || constraints.maximum === undefined || constraints.exclusiveMinimum < constraints.maximum,
    `${name} has @exclusiveMinimum greater than or equal to @maximum`);
  if (constraints.integer) {
    const first = Math.max(Number.MIN_SAFE_INTEGER, Math.ceil(constraints.minimum ?? -Infinity), Math.floor(constraints.exclusiveMinimum ?? -Infinity) + 1);
    const last = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(constraints.maximum ?? Infinity));
    invariant(first <= last, `${name} has no safe integers within its bounds`);
  }
}

function annotations(extractor: Extractor, symbol: Symbol): Pick<SchemaField, "constraints" | "deprecated" | "examples" | "default"> {
  const constraints: { minimum?: number; exclusiveMinimum?: number; integer?: true; maximum?: number; pattern?: string; maxLength?: number; minItems?: number; maxItems?: number; itemMinimum?: number; itemMaximum?: number; itemInteger?: true } = {};
  const examples: string[] = [];
  let deprecated: string | undefined;
  let defaultValue: SchemaField["default"];
  for (const tag of extractor.checker.getJsDocTagsOfSymbol(symbol)) {
    const text = tagText(tag);
    if (tag.name === "minimum" || tag.name === "maximum" || tag.name === "exclusiveMinimum" || tag.name === "itemMinimum" || tag.name === "itemMaximum") {
      const value = Number(text);
      invariant(text && Number.isFinite(value), `${symbol.name} has an invalid @${tag.name} value`);
      constraints[tag.name] = value;
    } else if (tag.name === "integer" || tag.name === "itemInteger") {
      invariant(!text, `${symbol.name} @${tag.name} does not accept a value`);
      constraints[tag.name] = true;
    } else if (tag.name === "maxLength" || tag.name === "minItems" || tag.name === "maxItems") {
      const value = Number(text);
      invariant(text && Number.isSafeInteger(value) && value >= 0, `${symbol.name} has an invalid @${tag.name} value`);
      constraints[tag.name] = value;
    } else if (tag.name === "pattern") {
      invariant(text, `${symbol.name} has an empty @pattern`);
      try {
        new RegExp(text);
      } catch {
        fail(`${symbol.name} has an invalid @pattern`);
      }
      constraints.pattern = text;
    } else if (tag.name === "default") {
      let value: unknown;
      try { value = JSON.parse(text); } catch { fail(`${symbol.name} has an invalid @default; use a JSON literal`); }
      invariant(value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)), `${symbol.name} @default must be a JSON literal`);
      invariant(defaultValue === undefined, `${symbol.name} has duplicate @default annotations`);
      defaultValue = value;
    } else if (tag.name === "deprecated") {
      deprecated = text || "Deprecated";
    } else if (tag.name === "example") {
      if (text) examples.push(text);
    }
  }
  validateConstraintRange(symbol.name, constraints);
  return {
    ...(Object.keys(constraints).length ? { constraints } : {}),
    ...(deprecated ? { deprecated } : {}),
    ...(examples.length ? { examples } : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  };
}

function validateDefault(field: SchemaField): void {
  const value = field.default;
  if (value === undefined) return;
  invariant(field.optional, `${field.name} @default requires an optional field`);
  const accepts = (type: SchemaType): boolean => type.kind === "literal" ? type.value === value
    : type.kind === "union" ? type.anyOf.some(accepts)
    : (type.kind === "string" || type.kind === "number" || type.kind === "boolean") && type.kind === typeof value;
  invariant(accepts(field.type), `${field.name} @default does not match its type`);
  const constraints = field.constraints;
  invariant(constraints?.minimum === undefined || (typeof value === "number" && value >= constraints.minimum), `${field.name} @default is below @minimum`);
  invariant(constraints?.exclusiveMinimum === undefined || (typeof value === "number" && value > constraints.exclusiveMinimum), `${field.name} @default is not above @exclusiveMinimum`);
  invariant(!constraints?.integer || (typeof value === "number" && Number.isSafeInteger(value)), `${field.name} @default is not a safe integer`);
  invariant(constraints?.maximum === undefined || (typeof value === "number" && value <= constraints.maximum), `${field.name} @default is above @maximum`);
  invariant(constraints?.pattern === undefined || (typeof value === "string" && new RegExp(constraints.pattern).test(value)), `${field.name} @default does not match @pattern`);
  invariant(constraints?.maxLength === undefined || (typeof value === "string" && Array.from(value).length <= constraints.maxLength), `${field.name} @default exceeds @maxLength`);
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
  // Recognize the complete recursive JSON algebra structurally, not by an alias
  // name or printed type. Other recursive shapes remain unsupported.
  if (type.isUnionType()) {
    const kinds = type.getTypes().map(part => {
      if (part.flags & TypeFlags.String) return "string";
      if (part.flags & TypeFlags.Number) return "number";
      if (part.flags & TypeFlags.Null) return "null";
      if (part.isLiteralType() && typeof part.value === "boolean") return String(part.value);
      if (part.isTypeReference() && extractor.checker.isArrayType(part)) {
        return extractor.checker.getTypeArguments(part)[0]?.id === type.id ? "array" : "other";
      }
      if (part.isObjectType() && !extractor.checker.getPropertiesOfType(part).length) {
        const indexes = extractor.checker.getIndexInfosOfType(part);
        if (indexes.length === 1 && indexes[0]!.keyType.flags & TypeFlags.String && indexes[0]!.valueType.id === type.id) return "record";
      }
      return "other";
    }).sort();
    if (kinds.join(",") === "array,false,null,number,record,string,true") return { kind: "json-value" };
  }
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
    const indexes = extractor.checker.getIndexInfosOfType(type);
    if (indexes.length) {
      invariant(indexes.length === 1 && indexes[0]!.keyType.flags & TypeFlags.String && !extractor.checker.getPropertiesOfType(type).length, `only plain string-keyed records are supported: ${display}`);
      return { kind: "record", values: schemaType(extractor, indexes[0]!.valueType, nextStack) };
    }
    const forbidden: string[] = [];
    const fields = extractor.checker.getPropertiesOfType(type)
      .flatMap((property) => {
        const field = extractField(extractor, property, false, nextStack);
        if (!field) forbidden.push(property.name);
        return field ? [field] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    invariant(fields.length || forbidden.length, `unsupported object type ${display}`);
    return { kind: "object", fields, ...(forbidden.length ? { forbidden: forbidden.sort() } : {}) };
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
    (constraints.minimum === undefined && constraints.exclusiveMinimum === undefined && constraints.maximum === undefined && !constraints.integer) || accepts(field.type, "number"),
    `${field.name} uses numeric bounds on a non-number type`,
  );
  invariant(
    constraints.pattern === undefined || accepts(field.type, "string"),
    `${field.name} uses @pattern on a non-string type`,
  );
  invariant(constraints.maxLength === undefined || accepts(field.type, "string"), `${field.name} uses @maxLength on a non-string type`);
  const arrays = field.type.kind === "union" ? field.type.anyOf : [field.type];
  invariant((constraints.minItems === undefined && constraints.maxItems === undefined) || arrays.every(type => type.kind === "array"), `${field.name} uses array bounds on a non-array type`);
  if (arrayItemConstraints(constraints)) {
    invariant(arrays.every(type => type.kind === "array"), `${field.name} uses item bounds on a non-array type`);
    invariant(arrays.every(type => type.kind === "array" && accepts(type.items, "number")), `${field.name} uses numeric item bounds on a non-number element type`);
  }
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
  if (!parts.length || parts.every((part) => part.flags & TypeFlags.Never)) {
    invariant(optional, `required field ${symbol.name} cannot be never`);
    return undefined;
  }
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
  validateDefault(schema);
  return schema;
}

function constraintsAreNarrower(provider: SchemaConstraints | undefined, base: SchemaConstraints | undefined): boolean {
  if (!base) return true;
  const baseLower = Math.max(base.minimum ?? -Infinity, base.exclusiveMinimum ?? -Infinity);
  const providerLower = Math.max(provider?.minimum ?? -Infinity, provider?.exclusiveMinimum ?? -Infinity);
  if (providerLower < baseLower || (providerLower === baseLower && base.exclusiveMinimum === baseLower && provider?.exclusiveMinimum !== providerLower)) return false;
  if (base.integer && !provider?.integer) return false;
  if (base.maximum !== undefined && (provider?.maximum === undefined || provider.maximum > base.maximum)) return false;
  if (base.pattern !== undefined && provider?.pattern !== base.pattern) return false;
  if (base.maxLength !== undefined && (provider?.maxLength === undefined || provider.maxLength > base.maxLength)) return false;
  if (base.minItems !== undefined && (provider?.minItems === undefined || provider.minItems < base.minItems)) return false;
  if (base.maxItems !== undefined && (provider?.maxItems === undefined || provider.maxItems > base.maxItems)) return false;
  if (!constraintsAreNarrower(arrayItemConstraints(provider), arrayItemConstraints(base))) return false;
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
  if (base.kind === "json-value") {
    const compatible = (type: SchemaType): boolean => ["string", "number", "boolean", "literal", "json-value"].includes(type.kind)
      || (type.kind === "array" && compatible(type.items)) || (type.kind === "record" && compatible(type.values))
      || (type.kind === "object" && type.fields.every(field => compatible(field.type)))
      || (type.kind === "union" && type.anyOf.every(compatible));
    if (!compatible(provider)) mismatch(context);
    return provider;
  }
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
      if (constraints) validateConstraintRange(field.name, constraints);
      validateDefault({ ...field, type, constraints });
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
    return { ...provider, fields };
  }
  if (provider.kind === "record" && base.kind === "record") return { kind: "record", values: compareSchema(provider.values, base.values, context) };
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

function withExtractor<Result>(options: { readonly root: string; readonly tsconfig: string }, extract: (extractor: Extractor) => Result): Result {
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
      return extract(extractor);
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

/** Normalize concrete exported types with the same checker semantics as requests. */
export function extractSchemaTypes(options: {
  readonly root: string;
  readonly tsconfig: string;
  readonly file: string;
  readonly names: readonly string[];
}): ReadonlyMap<string, SchemaType> {
  return withExtractor(options, extractor => {
    const file = sourceFile(extractor, path.resolve(extractor.root, options.file));
    const types = new Map<string, SchemaType>();
    for (const name of options.names) {
      invariant(!types.has(name), `duplicate schema export ${name}`);
      const symbol = findNamedSymbol(extractor, file, name);
      types.set(name, schemaType(extractor, extractor.checker.getDeclaredTypeOfSymbol(symbol)));
    }
    return types;
  });
}

export function extractSpeechSpec(options: ExtractSpeechSpecOptions): SpeechSpec {
  return withExtractor(options, extractor => {
    const baseFile = sourceFile(extractor, path.resolve(extractor.root, options.baseFile));
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
  });
}
