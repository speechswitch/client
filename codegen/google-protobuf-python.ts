import protobuf from "protobufjs";
import { parseGoogleProtobuf, type ProtoSource } from "./google-protobuf.ts";

const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** Compile the resolved RPC graph to concrete Python types and field operations. */
export function renderGoogleProtobufPython(sources: readonly ProtoSource[], service: string, method: string): string {
  const graph = parseGoogleProtobuf(sources, service, method);
  const { types, enums, name } = graph;
  const required = (field: protobuf.Field) => field.options?.["(google.api.field_behavior)"] === "REQUIRED";
  const wire = (field: protobuf.Field) => field.resolvedType instanceof protobuf.Type || ["string", "bytes"].includes(field.type) ? 2 : field.type === "double" ? 1 : 0;
  const fieldType = (field: protobuf.Field): string => field.resolvedType ? JSON.stringify(name(field.resolvedType)) : ({ string: "str", bytes: "bytes", bool: "bool", int32: "int", uint32: "int", double: "float" }[field.type]!);
  const out = ["# Generated from cataloged Google protobuf definitions. Do not edit.", "from collections.abc import Sequence", "from typing import Literal, Never, NotRequired, ReadOnly, TypedDict, cast", "from speechswitch.protobuf import ProtoReader, ProtoWriter", ""];
  const identifiers = new Set<string>();
  for (const id of [...types.keys(), ...enums.keys()]) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id) || identifiers.has(id)) throw new TypeError(`Invalid Python protobuf type name: ${id}`);
    identifiers.add(id);
  }
  for (const [id, type] of enums) out.push(`type ${id} = Literal[${Object.keys(type.values).map(v => JSON.stringify(v)).join(", ")}]`, `_${id}_values: dict[${id}, int] = ${JSON.stringify(type.values)}`, "");
  for (const [id, type] of types) {
    const fields = type.fieldsArray;
    const fieldNames = fields.map(field => snake(field.name));
    if (new Set(fieldNames).size !== fields.length) throw new TypeError(`Python protobuf field collision: ${id}`);
    const groups = type.oneofsArray.filter(group => group.fieldsArray.some(field => !field.options?.proto3_optional));
    const grouped = new Set(groups.flatMap(group => group.fieldsArray));
    let combinations: (protobuf.Field | undefined)[][] = [[]];
    for (const group of groups) {
      combinations = combinations.flatMap(previous => [...group.fieldsArray, undefined].map(field => [...previous, field]));
      if (combinations.length > 64) throw new TypeError(`Too many protobuf oneof combinations: ${id}`);
    }
    const variants: string[] = [];
    for (const [index, selected] of combinations.entries()) {
      const variant = groups.length ? `${id}Variant${index}` : id;
      if (groups.length && identifiers.has(variant)) throw new TypeError(`Colliding Python protobuf variant name: ${variant}`);
      identifiers.add(variant);
      variants.push(variant);
      out.push(`${variant} = TypedDict(${JSON.stringify(variant)}, {`);
      for (const field of fields) {
        const forbidden = grouped.has(field) && !selected.includes(field);
        const scalar = fieldType(field); const type = forbidden ? "Never" : field.repeated ? `Sequence[${scalar}]` : scalar;
        const optional = forbidden || (!selected.includes(field) && !required(field));
        out.push(`    ${JSON.stringify(snake(field.name))}: ${optional ? `NotRequired[ReadOnly[${type}]]` : `ReadOnly[${type}]`},`);
      }
      out.push("})", "");
    }
    if (groups.length) {
      out.push(`type ${id} = ${variants.join(" | ")}`, "", `_${id}Fields = TypedDict(${JSON.stringify(`_${id}Fields`)}, {`);
      for (const field of fields) {
        const scalar = fieldType(field); const type = field.repeated ? `Sequence[${scalar}]` : scalar;
        out.push(`    ${JSON.stringify(snake(field.name))}: ${required(field) && !grouped.has(field) ? `ReadOnly[${type}]` : `NotRequired[ReadOnly[${type}]]`},`);
      }
      out.push("})", "");
    }
    out.push(`def encode_${snake(id)}(value: ${id}) -> bytes:`, "    writer = ProtoWriter()");
    const input = groups.length ? "fields" : "value";
    // Explicit read-only widening avoids Pyright retaining Never branches in
    // flow analysis. The public input still enforces the complete oneof union.
    if (groups.length) out.push(`    fields = cast(_${id}Fields, value)`);
    for (const group of groups) out.push(`    if ${group.fieldsArray.map(field => `int(${JSON.stringify(snake(field.name))} in value)`).join(" + ")} > 1:`, `        raise TypeError(${JSON.stringify(`${id}.${group.name} permits at most one field`)})`);
    for (const field of fields) {
      const key = JSON.stringify(snake(field.name));
      if (required(field)) out.push(`    if ${key} not in value:`, `        raise TypeError(${JSON.stringify(`Missing ${id}.${field.name}`)})`);
      out.push(`    if ${key} in ${input}:`);
      const item = field.repeated ? "item" : `${input}[${key}]`;
      if (field.repeated) out.push(`        for item in ${input}[${key}]:`);
      const write = field.resolvedType instanceof protobuf.Type ? `bytes(encode_${snake(name(field.resolvedType))}(${item}))` : field.resolvedType instanceof protobuf.Enum ? `int32(_${name(field.resolvedType)}_values[${item}])` : `${field.type}(${item})`;
      out.push(`${field.repeated ? "            " : "        "}writer.uint32(${field.id * 8 + wire(field)}).${write}`);
    }
    out.push("    return writer.finish()", "");
  }
  const decoded = new Set<string>();
  function decoder(type: protobuf.Type) {
    const id = name(type); if (decoded.has(id)) return; decoded.add(id);
    if (type.oneofsArray.some(group => group.fieldsArray.some(field => !field.options?.proto3_optional))) throw new TypeError("Google response oneof decoding needs explicit support");
    if (type.fieldsArray.some(required)) throw new TypeError("Google required response field decoding needs explicit support");
    for (const field of type.fieldsArray) if (field.resolvedType instanceof protobuf.Type) decoder(field.resolvedType);
    out.push(`_${id}Decoded = TypedDict(${JSON.stringify(`_${id}Decoded`)}, {`);
    for (const field of type.fieldsArray) out.push(`    ${JSON.stringify(snake(field.name))}: NotRequired[${field.repeated ? `list[${fieldType(field)}]` : fieldType(field)}],`);
    out.push("})", "", `def decode_${snake(id)}(data: bytes) -> ${id}:`, "    reader = ProtoReader(data)", `    value: _${id}Decoded = {}`, "    while not reader.done:", "        tag = reader.uint32()", "        if tag >> 3 == 0:", '            raise TypeError("Invalid protobuf field number")');
    for (const [index, field] of type.fieldsArray.entries()) {
      if (field.resolvedType instanceof protobuf.Enum) throw new TypeError("Google response enum decoding is not supported");
      const read = field.resolvedType instanceof protobuf.Type ? `decode_${snake(name(field.resolvedType))}(reader.bytes())` : `reader.${field.type}()`;
      const key = JSON.stringify(snake(field.name));
      out.push(`        ${index ? "elif" : "if"} tag >> 3 == ${field.id}:`, `            if tag & 7 != ${wire(field)}:`, `                raise TypeError(${JSON.stringify(`Invalid protobuf wire type for ${id}.${field.name}`)})`, `            ${field.repeated ? `value.setdefault(${key}, []).append(${read})` : `value[${key}] = ${read}`}`);
    }
    out.push(...(type.fieldsArray.length ? ["        else:", "            reader.skip(tag & 7)"] : ["        reader.skip(tag & 7)"]), "    return value", "");
  }
  decoder(graph.response);
  out.push(`STREAMING_SYNTHESIZE_PATH = ${JSON.stringify(graph.path)}`, `encode_streaming_request = encode_${snake(name(graph.request))}`, `decode_streaming_response = decode_${snake(name(graph.response))}`, "");
  return out.join("\n");
}
