import path from "node:path";
import {
  API,
  SymbolFlags,
  type Checker,
  type JSDocTagInfo,
  type Project,
  type Symbol,
  type Type,
} from "typescript/unstable/sync";
import type { Node, SourceFile } from "typescript/unstable/ast";
import type {
  SchemaConstraints,
  SchemaField,
  SchemaType,
  SpeechSpec,
  TtsModelSpec,
  TtsProviderSpec,
} from "./spec-model.ts";

export interface ProviderSpecSource {
  readonly id: string;
  readonly file: string;
}

export interface ExtractSpeechSpecOptions {
  readonly root: string;
  readonly tsconfig?: string;
  readonly baseFile?: string;
  readonly providers?: readonly ProviderSpecSource[];
}

interface NamedNode extends Node {
  readonly name?: Node & { readonly text?: string };
}

interface ExtractedField {
  readonly schema: SchemaField;
  readonly compilerType: Type;
}

interface Extractor {
  readonly checker: Checker;
  readonly project: Project;
  readonly root: string;
}

function fail(message: string): never {
  throw new TypeError(`Speech spec: ${message}`);
}

function findNamedSymbol(extractor: Extractor, file: SourceFile, name: string): Symbol {
  const statement = file.statements.find((candidate) => (candidate as NamedNode).name?.text === name) as NamedNode | undefined;
  const nameNode = statement?.name;
  if (!nameNode) fail(`${path.relative(extractor.root, file.fileName)} must export ${name}`);
  const symbol = extractor.checker.getSymbolAtLocation(nameNode);
  if (!symbol) fail(`could not resolve ${name} in ${path.relative(extractor.root, file.fileName)}`);
  const moduleSymbol = extractor.checker.getSymbolAtLocation(file);
  const exported = moduleSymbol && extractor.checker.getExportsOfModule(moduleSymbol).some((candidate) => candidate.name === name);
  if (!exported) fail(`${name} must be exported from ${path.relative(extractor.root, file.fileName)}`);
  return symbol;
}

function sourceFile(extractor: Extractor, fileName: string): SourceFile {
  const file = extractor.project.program.getSourceFile(fileName);
  if (!file) fail(`${path.relative(extractor.root, fileName)} is not included by the project`);
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
      if (!text || !Number.isFinite(value)) fail(`${symbol.name} has an invalid @${tag.name} value`);
      constraints[tag.name] = value;
    } else if (tag.name === "pattern") {
      if (!text) fail(`${symbol.name} has an empty @pattern`);
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
  if (constraints.minimum !== undefined && constraints.maximum !== undefined && constraints.minimum > constraints.maximum) {
    fail(`${symbol.name} has @minimum greater than @maximum`);
  }
  return {
    ...(Object.keys(constraints).length ? { constraints } : {}),
    ...(deprecated ? { deprecated } : {}),
    ...(examples.length ? { examples } : {}),
  };
}

function withoutUndefined(type: Type): Type[] {
  if (type.isIntrinsicType() && type.intrinsicName === "undefined") return [];
  if (!type.isUnionType()) return [type];
  return type.getTypes().filter((part) => !(part.isIntrinsicType() && part.intrinsicName === "undefined"));
}

function schemaType(extractor: Extractor, type: Type, stack: ReadonlySet<number> = new Set()): SchemaType {
  const rendered = extractor.checker.typeToString(type);
  if (rendered === "Uint8Array" || rendered.startsWith("Uint8Array<")) return { kind: "bytes" };
  if (rendered === "AsyncIterable<string>" || rendered.startsWith("AsyncIterable<")) {
    const item = type.isTypeReference() ? extractor.checker.getTypeArguments(type)[0] : undefined;
    if (!item) fail(`could not resolve ${rendered}`);
    return { kind: "async-iterable", items: schemaType(extractor, item, stack) };
  }
  if (type.isUnionType()) {
    const parts = withoutUndefined(type);
    if (parts.length === 1) return schemaType(extractor, parts[0]!, stack);
    return { kind: "union", anyOf: parts.map((part) => schemaType(extractor, part, stack)) };
  }
  if (type.isLiteralType()) {
    const value = type.value;
    if (typeof value === "bigint") fail(`bigint literals are not portable: ${rendered}`);
    return { kind: "literal", value };
  }
  if (type.isIntrinsicType()) {
    if (type.intrinsicName === "string") return { kind: "string" };
    if (type.intrinsicName === "number") return { kind: "number" };
    if (type.intrinsicName === "boolean") return { kind: "boolean" };
    if (type.intrinsicName === "bigint") return { kind: "bigint" };
    if (type.intrinsicName === "null") return { kind: "literal", value: null };
    fail(`unsupported type ${rendered}`);
  }
  if (extractor.checker.isArrayType(type) || rendered.startsWith("readonly ") || rendered.startsWith("ReadonlyArray<")) {
    const item = type.isTypeReference() ? extractor.checker.getTypeArguments(type)[0] : undefined;
    if (!item) fail(`could not resolve array element type for ${rendered}`);
    return { kind: "array", items: schemaType(extractor, item, stack) };
  }
  if (type.isObjectType()) {
    if (stack.has(type.id)) fail(`recursive object types are not supported: ${rendered}`);
    const nextStack = new Set(stack).add(type.id);
    const fields = extractor.checker.getPropertiesOfType(type)
      .map((property) => extractField(extractor, property, false, nextStack).schema)
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!fields.length) fail(`unsupported object type ${rendered}`);
    return { kind: "object", fields };
  }
  fail(`unsupported type ${rendered}`);
}

function constraintsMatchType(field: SchemaField): void {
  const constraints = field.constraints;
  if (!constraints) return;
  const accepts = (type: SchemaType, primitive: "number" | "string"): boolean => {
    if (type.kind === primitive) return true;
    if (type.kind === "literal") return typeof type.value === primitive;
    return type.kind === "union" && type.anyOf.every((part) => accepts(part, primitive));
  };
  if ((constraints.minimum !== undefined || constraints.maximum !== undefined) && !accepts(field.type, "number")) {
    fail(`${field.name} uses numeric bounds on a non-number type`);
  }
  if (constraints.pattern !== undefined && !accepts(field.type, "string")) {
    fail(`${field.name} uses @pattern on a non-string type`);
  }
}

function extractField(
  extractor: Extractor,
  symbol: Symbol,
  requireDocumentation: boolean,
  stack?: ReadonlySet<number>,
): ExtractedField {
  const compilerType = extractor.checker.getTypeOfSymbol(symbol);
  if (!compilerType) fail(`could not resolve field ${symbol.name}`);
  const docs = documentation(extractor, symbol);
  if (requireDocumentation && !docs) fail(`public base field ${symbol.name} must have documentation`);
  const parts = withoutUndefined(compilerType);
  if (!parts.length) fail(`${symbol.name} cannot contain only undefined`);
  const normalizedType = parts.length === 1
    ? schemaType(extractor, parts[0]!, stack)
    : { kind: "union", anyOf: parts.map((part) => schemaType(extractor, part, stack)) } satisfies SchemaType;
  const schema: SchemaField = {
    name: symbol.name,
    optional: Boolean(symbol.flags & SymbolFlags.Optional),
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

function extractModel(
  extractor: Extractor,
  model: Symbol,
  baseFields: ReadonlyMap<string, ExtractedField>,
): TtsModelSpec {
  const modelType = extractor.checker.getTypeOfSymbol(model);
  if (!modelType) fail(`could not resolve model ${model.name}`);
  if (model.flags & SymbolFlags.Optional) fail(`model ${model.name} cannot be optional`);
  const request = extractModelRequest(extractor, modelType, model.name, baseFields);
  const modelDocumentation = documentation(extractor, model);
  return {
    id: model.name,
    ...(modelDocumentation ? { documentation: modelDocumentation } : {}),
    request,
  };
}

function extractModelRequest(
  extractor: Extractor,
  type: Type,
  modelName: string,
  baseFields: ReadonlyMap<string, ExtractedField>,
): SchemaType {
  if (type.isUnionType()) {
    const parts = withoutUndefined(type);
    if (parts.length !== type.getTypes().length) fail(`model ${modelName} cannot be optional`);
    return { kind: "union", anyOf: parts.map((part) => extractModelRequest(extractor, part, modelName, baseFields)) };
  }
  if (!type.isObjectType()) fail(`model ${modelName} request must be an object or a union of objects`);
  if (extractor.checker.getIndexInfosOfType(type).length) {
    fail(`model ${modelName} must list normalized fields explicitly`);
  }
  const fields = extractor.checker.getPropertiesOfType(type).flatMap((field) => {
    const compilerType = extractor.checker.getTypeOfSymbol(field);
    if (!compilerType) fail(`could not resolve model ${modelName} field ${field.name}`);
    if (withoutUndefined(compilerType).length === 0 && field.flags & SymbolFlags.Optional) return [];
    const base = baseFields.get(field.name);
    if (!base) fail(`model ${modelName} introduces unknown field ${field.name}`);
    const extracted = extractField(extractor, field, false);
    if (!extractor.checker.isTypeAssignableTo(extracted.compilerType, base.compilerType)) {
      fail(`model ${modelName} field ${field.name} widens ${base.schema.typeScriptType} to ${extracted.schema.typeScriptType}`);
    }
    const constraints = base.schema.constraints || extracted.schema.constraints
      ? { ...base.schema.constraints, ...extracted.schema.constraints }
      : undefined;
    if (!constraintsAreNarrower(constraints, base.schema.constraints)) {
      fail(`model ${modelName} field ${field.name} has constraints wider than the base field`);
    }
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
  if (!fields.length) fail(`model ${modelName} request must contain at least one normalized field`);
  return { kind: "object", fields };
}

function extractProvider(
  extractor: Extractor,
  provider: ProviderSpecSource,
  baseFields: ReadonlyMap<string, ExtractedField>,
): TtsProviderSpec {
  const file = sourceFile(extractor, path.resolve(extractor.root, provider.file));
  const modelsSymbol = findNamedSymbol(extractor, file, "TtsModels");
  const modelsType = extractor.checker.getDeclaredTypeOfSymbol(modelsSymbol);
  if (extractor.checker.getIndexInfosOfType(modelsType).length) {
    fail(`provider ${provider.id} must list exact model identifiers`);
  }
  const models = extractor.checker.getPropertiesOfType(modelsType)
    .map((model) => extractModel(extractor, model, baseFields))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!models.length) fail(`provider ${provider.id} must declare at least one TTS model`);
  return { id: provider.id, models };
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

/** Extract the normalized speech API through TypeScript 7's native checker. */
export function extractSpeechSpec(options: ExtractSpeechSpecOptions): SpeechSpec {
  const root = path.resolve(options.root);
  const tsconfig = path.resolve(root, options.tsconfig ?? "tsconfig.json");
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [tsconfig] });
    try {
      const project = snapshot.getProject(tsconfig) ?? snapshot.getProjects()[0];
      if (!project) fail(`could not open ${path.relative(root, tsconfig)}`);
      const diagnostics = diagnosticText(project);
      if (diagnostics) fail(`TypeScript project contains errors:\n${diagnostics}`);
      const extractor: Extractor = { checker: project.checker, project, root };
      const baseFile = sourceFile(extractor, path.resolve(root, options.baseFile ?? "sdk/tts-request.ts"));
      const baseSymbol = findNamedSymbol(extractor, baseFile, "TtsRequestBase");
      const baseType = extractor.checker.getDeclaredTypeOfSymbol(baseSymbol);
      if (extractor.checker.getIndexInfosOfType(baseType).length) {
        fail("TtsRequestBase must list normalized fields explicitly");
      }
      const extractedBaseFields = extractor.checker.getPropertiesOfType(baseType)
        .map((field) => extractField(extractor, field, true))
        .sort((left, right) => left.schema.name.localeCompare(right.schema.name));
      const baseFields = new Map(extractedBaseFields.map((field) => [field.schema.name, field]));
      const providerSources = [...(options.providers ?? [])];
      const duplicateProvider = providerSources.find((provider, index) =>
        providerSources.findIndex((candidate) => candidate.id === provider.id) !== index);
      if (duplicateProvider) fail(`duplicate provider id ${duplicateProvider.id}`);
      const providers = providerSources
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((provider) => extractProvider(extractor, provider, baseFields));
      return {
        tts: {
          request: {
            name: "TtsRequestBase",
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
