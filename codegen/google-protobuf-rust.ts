import protobuf from "protobufjs";
import { pascal, snake } from "./language-types.ts";
import { parseGoogleProtobuf, type ProtoSource } from "./google-protobuf.ts";

/** Concrete Rust types and field operations, resolved entirely at build time. */
export function renderGoogleProtobufRust(sources: readonly ProtoSource[], service: string, method: string): string {
  const graph = parseGoogleProtobuf(sources, service, method);
  const name = (type: protobuf.ReflectionObject) => pascal(graph.name(type));
  const required = (field: protobuf.Field) => field.options?.["(google.api.field_behavior)"] === "REQUIRED";
  const groups = (type: protobuf.Type) => type.oneofsArray.filter(group => group.fieldsArray.some(field => !field.options?.proto3_optional));
  const wire = (field: protobuf.Field) => field.resolvedType instanceof protobuf.Type || ["string", "bytes"].includes(field.type) ? 2 : field.type === "double" ? 1 : 0;
  const scalar = (field: protobuf.Field): string => field.resolvedType ? name(field.resolvedType) : ({ string: "String", bytes: "Vec<u8>", bool: "bool", int32: "i32", uint32: "u32", double: "f64" }[field.type]!);
  const identifiers = new Set(["String", "Vec", "Option", "Result", "Error", "Reader", "Writer", "STREAMING_SYNTHESIZE_PATH", "encode_streaming_request", "decode_streaming_response"]);
  function reserve(id: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || identifiers.has(id)) throw new TypeError(`Colliding or invalid Rust protobuf identifier: ${id}`);
    identifiers.add(id);
  }
  for (const type of [...graph.types.values(), ...graph.enums.values()]) reserve(name(type));
  const visiting = new Set<protobuf.Type>(); const visited = new Set<protobuf.Type>();
  function visit(type: protobuf.Type) {
    if (visiting.has(type)) throw new TypeError(`Recursive Rust protobuf message: ${name(type)}`);
    if (visited.has(type)) return;
    visiting.add(type);
    for (const field of type.fieldsArray) {
      if (field.resolvedType instanceof protobuf.Type) visit(field.resolvedType);
      if (field.repeated && !(field.resolvedType instanceof protobuf.Type) && !["string", "bytes"].includes(field.type)) throw new TypeError(`Packed Rust protobuf fields need explicit support: ${field.fullName}`);
    }
    for (const group of groups(type)) if (group.fieldsArray.some(required)) throw new TypeError(`Required Rust protobuf oneof needs explicit support: ${group.fullName}`);
    visiting.delete(type); visited.add(type);
  }
  for (const type of graph.types.values()) visit(type);
  const out = ["// Generated from cataloged Google protobuf definitions. Do not edit.", "#![allow(dead_code)]", "use crate::protobuf::{Error, Reader, Writer};", ""];
  const variant = (key: string) => pascal(snake(key));
  for (const type of graph.enums.values()) {
    const id = name(type); const keys = Object.keys(type.values);
    if (new Set(keys.map(variant)).size !== keys.length) throw new TypeError(`Rust protobuf enum variant collision: ${id}`);
    out.push("#[derive(Debug, Clone, Copy, PartialEq, Eq)]", `pub enum ${id} {`, ...keys.map(key => `    ${variant(key)},`), "}", `impl ${id} {`, "    fn number(&self) -> i32 { match self {", ...Object.entries(type.values).map(([key, value]) => `        Self::${variant(key)} => ${value},`), "    } }", "}", "");
  }
  for (const type of graph.types.values()) {
    const id = name(type); reserve(`encode_${snake(id)}`);
    const oneofs = groups(type); const grouped = new Set(oneofs.flatMap(group => group.fieldsArray));
    const common = type.fieldsArray.filter(field => !grouped.has(field));
    const fields = [...common.map(field => snake(field.name)), ...oneofs.map(group => snake(group.name))];
    if (new Set(fields).size !== fields.length) throw new TypeError(`Rust protobuf field collision: ${id}`);
    out.push(`#[derive(Debug, Clone, PartialEq${common.every(field => !required(field) || field.repeated) ? ", Default" : ""})]`, `pub struct ${id} {`);
    for (const field of common) out.push(`    pub ${snake(field.name)}: ${field.repeated ? `Vec<${scalar(field)}>` : required(field) ? scalar(field) : `Option<${scalar(field)}>`},`);
    for (const group of oneofs) out.push(`    pub ${snake(group.name)}: Option<${id + pascal(group.name)}>,`);
    out.push("}");
    for (const group of oneofs) {
      const groupName = id + pascal(group.name); reserve(groupName);
      if (new Set(group.fieldsArray.map(field => variant(field.name))).size !== group.fieldsArray.length) throw new TypeError(`Rust protobuf oneof variant collision: ${groupName}`);
      out.push("#[derive(Debug, Clone, PartialEq)]", `pub enum ${groupName} {`, ...group.fieldsArray.map(field => `    ${variant(field.name)}(${scalar(field)}),`), "}");
    }
    out.push(`pub fn encode_${snake(id)}(value: &${id}) -> Result<Vec<u8>, Error> {`, "    let mut writer = Writer::default();");
    function write(field: protobuf.Field, value: string) {
      const tag = field.id * 8 + wire(field);
      if (field.resolvedType instanceof protobuf.Type) out.push(`    writer.uint32(${tag}).bytes(&encode_${snake(name(field.resolvedType))}(${value})?);`);
      else if (field.resolvedType instanceof protobuf.Enum) out.push(`    writer.uint32(${tag}).int32((${value}).number());`);
      else out.push(`    writer.uint32(${tag}).${field.type}(${["string", "bytes"].includes(field.type) ? value : `*(${value})`});`);
    }
    const emitted = new Set<protobuf.OneOf>();
    for (const field of type.fieldsArray) {
      const group = oneofs.find(group => group.fieldsArray.includes(field));
      if (group) {
        if (emitted.has(group)) continue; emitted.add(group);
        out.push(`    if let Some(item) = &value.${snake(group.name)} { match item {`);
        for (const alternative of group.fieldsArray) { out.push(`    ${id + pascal(group.name)}::${variant(alternative.name)}(item) => {`); write(alternative, "item"); out.push("    }"); }
        out.push("    } }");
      } else {
        const access = `&value.${snake(field.name)}`;
        if (field.repeated) { out.push(`    for item in ${access} {`); write(field, "item"); out.push("    }"); }
        else if (required(field)) write(field, access);
        else { out.push(`    if let Some(item) = ${access} {`); write(field, "item"); out.push("    }"); }
      }
    }
    out.push("    writer.finish()", "}", "");
  }
  const decoded = new Set<protobuf.Type>();
  function decoder(type: protobuf.Type) {
    if (decoded.has(type)) return; decoded.add(type);
    const id = name(type); reserve(`decode_${snake(id)}`); reserve(`merge_${snake(id)}`);
    if (groups(type).length) throw new TypeError("Google response oneof decoding needs explicit support");
    if (type.fieldsArray.some(required)) throw new TypeError("Google required response field decoding needs explicit support");
    for (const field of type.fieldsArray) if (field.resolvedType instanceof protobuf.Type) decoder(field.resolvedType);
    out.push(`fn merge_${snake(id)}(data: &[u8], value: &mut ${id}) -> Result<(), Error> {`, "    let mut reader = Reader::new(data);", "    while !reader.done() {", "        let tag = reader.uint32()?;", '        if tag >> 3 == 0 { return Err(Error("Invalid protobuf field number".into())); }', "        match tag >> 3 {");
    for (const field of type.fieldsArray) {
      if (field.resolvedType instanceof protobuf.Enum) throw new TypeError("Google response enum decoding is not supported");
      const read = field.resolvedType instanceof protobuf.Type ? `decode_${snake(name(field.resolvedType))}(reader.bytes()?)?` : field.type === "bytes" ? "reader.bytes()?.to_vec()" : `reader.${field.type}()?`;
      const assignment = field.resolvedType instanceof protobuf.Type && !field.repeated
        ? `merge_${snake(name(field.resolvedType))}(reader.bytes()?, value.${snake(field.name)}.get_or_insert_with(${name(field.resolvedType)}::default))?`
        : `value.${snake(field.name)}${field.repeated ? `.push(${read})` : ` = Some(${read})`}`;
      out.push(`            ${field.id} => {`, `                if tag & 7 != ${wire(field)} { return Err(Error(${JSON.stringify(`Invalid protobuf wire type for ${graph.name(type)}.${field.name}`)}.into())); }`, `                ${assignment};`, "            }");
    }
    out.push("            _ => reader.skip(tag & 7)?,", "        }", "    }", "    Ok(())", "}", `pub fn decode_${snake(id)}(data: &[u8]) -> Result<${id}, Error> {`, `    let mut value = ${id}::default();`, `    merge_${snake(id)}(data, &mut value)?;`, "    Ok(value)", "}", "");
  }
  decoder(graph.response);
  out.push(`pub const STREAMING_SYNTHESIZE_PATH: &str = ${JSON.stringify(graph.path)};`, "#[allow(unused_imports)]", `pub use encode_${snake(name(graph.request))} as encode_streaming_request;`, "#[allow(unused_imports)]", `pub use decode_${snake(name(graph.response))} as decode_streaming_response;`, "");
  return out.join("\n");
}
