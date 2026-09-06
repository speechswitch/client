import protobuf from "protobufjs";

export interface ProtoSource { readonly name: string; readonly text: string }

/** Parse upstream messages and resolve their imports at build time only. */
export function parseGoogleProtobuf(sources: readonly ProtoSource[], serviceName: string, methodName: string) {
  const root = new protobuf.Root(); const names = new Set(sources.map(source => source.name));
  for (const source of sources) {
    const parsed = protobuf.parse(source.text, root);
    for (const imported of [...parsed.imports ?? [], ...parsed.weakImports ?? []]) {
      if (!names.has(imported)) throw new TypeError(`Uncataloged protobuf import: ${imported}`);
    }
  }
  root.resolveAll();
  const service = root.lookupService(serviceName); const method = service.methods[methodName];
  if (!method) throw new TypeError(`Missing Google protobuf method: ${methodName}`);
  method.resolve();
  if (!method.requestStream || !method.responseStream) throw new TypeError("Google synthesis RPC must remain bidirectional");
  const request = method.resolvedRequestType!; const response = method.resolvedResponseType!;
  const prefix = service.parent!.fullName + ".";
  const name = (type: protobuf.ReflectionObject) => {
    if (!type.fullName.startsWith(prefix)) throw new TypeError(`Unsupported external protobuf message: ${type.fullName}`);
    return type.fullName.slice(prefix.length).replaceAll(".", "");
  };
  const types = new Map<string, protobuf.Type>(); const enums = new Map<string, protobuf.Enum>();
  const visit = (type: protobuf.Type) => {
    const previous = types.get(name(type));
    if (previous && previous !== type) throw new TypeError(`Colliding protobuf type name: ${name(type)}`);
    if (previous) return; types.set(name(type), type);
    for (const field of type.fieldsArray) {
      field.resolve();
      if (field.map) throw new TypeError(`Unsupported protobuf map: ${field.fullName}`);
      if (field.resolvedType instanceof protobuf.Type) visit(field.resolvedType);
      else if (field.resolvedType instanceof protobuf.Enum) {
        const id = name(field.resolvedType); const previous = enums.get(id);
        if (previous && previous !== field.resolvedType) throw new TypeError(`Colliding protobuf type name: ${id}`);
        enums.set(id, field.resolvedType);
      }
      else if (!["string", "bytes", "bool", "int32", "uint32", "double"].includes(field.type)) throw new TypeError(`Unsupported protobuf scalar: ${field.type}`);
    }
  };
  visit(request); visit(response);
  for (const id of enums.keys()) if (types.has(id)) throw new TypeError(`Colliding protobuf type name: ${id}`);
  return { types, enums, request, response, name, path: `/${service.fullName.slice(1)}/${method.name}` };
}

export function renderGoogleProtobuf(sources: readonly ProtoSource[], serviceName: string, methodName: string): string {
  const { types, enums, request, response, name, path } = parseGoogleProtobuf(sources, serviceName, methodName);
  const fieldType = (field: protobuf.Field): string => field.resolvedType ? name(field.resolvedType)
    : field.type === "bytes" ? "Uint8Array" : field.type === "bool" ? "boolean" : field.type === "string" ? "string" : "number";
  const required = (field: protobuf.Field) => field.options?.["(google.api.field_behavior)"] === "REQUIRED";
  const wireType = (field: protobuf.Field) => field.resolvedType instanceof protobuf.Type || ["string", "bytes"].includes(field.type) ? 2 : field.type === "double" ? 1 : 0;
  const out = ["// Generated from cataloged Google protobuf definitions. Do not edit.", 'import { ProtoReader, ProtoWriter } from "../../runtime/protobuf.ts";', ""];
  for (const [id, type] of enums) out.push(`export const ${id} = ${JSON.stringify(type.values)} as const;`, `export type ${id} = keyof typeof ${id};`, "");
  for (const [id, type] of types) {
    const common = type.fieldsArray.filter(field => !field.partOf || field.options?.proto3_optional);
    const groups = type.oneofsArray.filter(group => group.fieldsArray.some(field => !field.options?.proto3_optional));
    const property = (field: protobuf.Field) => `readonly ${field.name}${required(field) ? "" : "?"}: ${field.repeated ? `readonly (${fieldType(field)})[]` : fieldType(field)};`;
    out.push(`export type ${id} = {`, ...common.map(field => `  ${property(field)}`), `}${groups.map(group => ` & (${[...group.fieldsArray, undefined].map(selected => `{ ${group.fieldsArray.map(field => field === selected ? `readonly ${field.name}: ${fieldType(field)};` : `readonly ${field.name}?: never;`).join(" ")} }`).join(" | ")})`).join("")};`, "");
    out.push(`export function encode${id}(value: ${id}): Uint8Array<ArrayBuffer> {`, "  const writer = new ProtoWriter();");
    for (const group of groups) out.push(`  if (${group.fieldsArray.map(field => `Number(value.${field.name} !== undefined)`).join(" + ")} > 1) throw new TypeError(${JSON.stringify(`${id}.${group.name} permits at most one field`)});`);
    for (const field of type.fieldsArray) {
      if (required(field)) out.push(`  if (value.${field.name} === undefined) throw new TypeError(${JSON.stringify(`Missing ${id}.${field.name}`)});`);
      const item = field.repeated ? "item" : `value.${field.name}`;
      const write = field.resolvedType instanceof protobuf.Type ? `bytes(encode${name(field.resolvedType)}(${item}))`
        : field.resolvedType instanceof protobuf.Enum ? `int32(${name(field.resolvedType)}[${item}])` : `${field.type}(${item})`;
      out.push(`  if (value.${field.name} !== undefined) ${field.repeated ? `{ for (const item of value.${field.name}) writer.uint32(${field.id * 8 + wireType(field)}).${write}; }` : `writer.uint32(${field.id * 8 + wireType(field)}).${write};`}`);
    }
    out.push("  return writer.finish();", "}", "");
  }
  // Only response fields need decoders. Resolve their structure now, not at runtime.
  const decoded = new Set<string>();
  const decoder = (type: protobuf.Type) => {
    const id = name(type); if (decoded.has(id)) return; decoded.add(id);
    if (type.oneofsArray.some(group => group.fieldsArray.some(field => !field.options?.proto3_optional))) throw new TypeError("Google response oneof decoding needs explicit support");
    for (const field of type.fieldsArray) if (field.resolvedType instanceof protobuf.Type) decoder(field.resolvedType);
    out.push(`export function decode${id}(data: Uint8Array): ${id} {`, "  const reader = new ProtoReader(data);", `  const value: { ${type.fieldsArray.map(field => `${field.name}?: ${field.repeated ? `${fieldType(field)}[]` : fieldType(field)};`).join(" ")} } = {};`, "  while (!reader.done) {", "    const tag = reader.uint32();", '    if ((tag >>> 3) === 0) throw new TypeError("Invalid protobuf field number");', "    switch (tag >>> 3) {");
    for (const field of type.fieldsArray) {
      if (field.resolvedType instanceof protobuf.Enum) throw new TypeError("Google response enum decoding is not supported");
      const read = field.resolvedType instanceof protobuf.Type ? `decode${name(field.resolvedType)}(reader.bytes())` : `reader.${field.type}()`;
      out.push(`      case ${field.id}:`, `        if ((tag & 7) !== ${wireType(field)}) throw new TypeError(${JSON.stringify(`Invalid protobuf wire type for ${id}.${field.name}`)});`, `        ${field.repeated ? `(value.${field.name} ??= []).push(${read});` : `value.${field.name} = ${read};`}`, "        break;");
    }
    out.push("      default: reader.skip(tag & 7);", "    }", "  }", `  return value as ${id};`, "}", "");
  };
  decoder(response);
  out.push(`export const streamingSynthesizePath = ${JSON.stringify(path)};`, `export const encodeStreamingRequest = encode${name(request)};`, `export const decodeStreamingResponse = decode${name(response)};`, "");
  return out.join("\n");
}
