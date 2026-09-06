import protobuf from "protobufjs";
import { pascal } from "./language-types.ts";
import { parseGoogleProtobuf, type ProtoSource } from "./google-protobuf.ts";

/** Resolve wire structure at build time; generated Go contains direct field operations. */
export function renderGoogleProtobufGo(sources: readonly ProtoSource[], service: string, method: string, packageName: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(packageName) || ["type", "var", "func", "package", "map", "import", "range", "go", "select", "interface", "struct", "const", "return", "chan", "defer", "else", "for", "if", "switch", "case", "default", "break", "continue", "fallthrough", "goto"].includes(packageName)) throw new TypeError(`Invalid Go protobuf package: ${packageName}`);
  const graph = parseGoogleProtobuf(sources, service, method);
  const { types, enums, name } = graph;
  const required = (field: protobuf.Field) => field.options?.["(google.api.field_behavior)"] === "REQUIRED";
  const groups = (type: protobuf.Type) => type.oneofsArray.filter(group => group.fieldsArray.some(field => !field.options?.proto3_optional));
  const wire = (field: protobuf.Field) => field.resolvedType instanceof protobuf.Type || ["string", "bytes"].includes(field.type) ? 2 : field.type === "double" ? 1 : 0;
  const fieldType = (field: protobuf.Field): string => field.resolvedType ? name(field.resolvedType) : ({ string: "string", bytes: "[]byte", bool: "bool", int32: "int32", uint32: "uint32", double: "float64" }[field.type]!);
  const identifiers = new Set(["StreamingSynthesizePath", "EncodeStreamingRequest", "DecodeStreamingResponse"]);
  function reserve(id: string) {
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(id) || identifiers.has(id)) throw new TypeError(`Colliding or invalid Go protobuf identifier: ${id}`);
    identifiers.add(id);
  }
  for (const id of [...types.keys(), ...enums.keys()]) reserve(id);
  // Value structs (including Optional[T]) cannot represent recursive messages.
  // Fail at the contract boundary until recursive wire types have explicit support.
  const visited = new Set<protobuf.Type>(); const visiting = new Set<protobuf.Type>();
  function visit(type: protobuf.Type) {
    if (visiting.has(type)) throw new TypeError(`Recursive Go protobuf message: ${name(type)}`);
    if (visited.has(type)) return;
    visiting.add(type);
    for (const field of type.fieldsArray) if (field.resolvedType instanceof protobuf.Type) visit(field.resolvedType);
    visiting.delete(type); visited.add(type);
  }
  for (const type of types.values()) visit(type);
  for (const type of types.values()) for (const field of type.fieldsArray) {
    if (field.repeated && !(field.resolvedType instanceof protobuf.Type) && !["string", "bytes"].includes(field.type)) throw new TypeError(`Packed Go protobuf fields need explicit support: ${field.fullName}`);
  }
  const out = ["// Generated from cataloged Google protobuf definitions. Do not edit.", `package ${packageName}`, "", 'import ("errors"; "github.com/speechswitch/client/sdks/go/runtime")', ""];
  for (const [id, type] of enums) {
    out.push(`type ${id} interface { is${id}() }`);
    for (const key of Object.keys(type.values)) {
      const variant = `${id}_${key}`; reserve(variant);
      out.push(`type ${variant} struct {}`, `func (${variant}) is${id}() {}`);
    }
    out.push(`func number${id}(value ${id}) (int32, error) {`, "switch value := value.(type) {");
    for (const [key, value] of Object.entries(type.values)) out.push(`case ${id}_${key}: return ${value}, nil`, `case *${id}_${key}: if value != nil { return ${value}, nil }`);
    out.push("}", `return 0, errors.New(${JSON.stringify(`Invalid protobuf ${id}`)})`, "}", "");
  }
  for (const [id, type] of types) {
    reserve(`Encode${id}`);
    const oneofs = groups(type); const grouped = new Set(oneofs.flatMap(group => group.fieldsArray));
    const fields = [...type.fieldsArray.filter(field => !grouped.has(field)).map(field => pascal(field.name)), ...oneofs.map(group => pascal(group.name))];
    if (new Set(fields).size !== fields.length) throw new TypeError(`Go protobuf field collision: ${id}`);
    out.push(`type ${id} struct {`);
    for (const field of type.fieldsArray.filter(field => !grouped.has(field))) {
      const scalar = fieldType(field);
      out.push(`${pascal(field.name)} ${field.repeated ? `[]${scalar}` : required(field) ? scalar : `runtime.Optional[${scalar}]`}`);
    }
    for (const group of oneofs) out.push(`${pascal(group.name)} ${id + pascal(group.name)}`);
    out.push("}");
    for (const group of oneofs) {
      const groupName = id + pascal(group.name); reserve(groupName);
      out.push(`type ${groupName} interface { is${groupName}() }`);
      for (const field of group.fieldsArray) {
        const variant = `${id}_${pascal(field.name)}`; reserve(variant);
        out.push(`type ${variant} struct { Value ${fieldType(field)} }`, `func (${variant}) is${groupName}() {}`);
      }
    }
    out.push("", `func Encode${id}(value ${id}) ([]byte, error) {`, "var writer runtime.ProtoWriter");
    function write(field: protobuf.Field, value: string) {
      const tag = field.id * 8 + wire(field);
      if (field.resolvedType instanceof protobuf.Type) out.push(`data, err := Encode${name(field.resolvedType)}(${value}); if err != nil { return nil, err }`, `writer.Uint32(${tag}).Bytes(data)`);
      else if (field.resolvedType instanceof protobuf.Enum) out.push(`number, err := number${name(field.resolvedType)}(${value}); if err != nil { return nil, err }`, `writer.Uint32(${tag}).Int32(number)`);
      else out.push(`writer.Uint32(${tag}).${pascal(field.type)}(${value})`);
    }
    const emitted = new Set<protobuf.OneOf>();
    for (const field of type.fieldsArray) {
      const group = oneofs.find(group => group.fieldsArray.includes(field));
      if (group) {
        if (emitted.has(group)) continue; emitted.add(group);
        out.push(`switch item := value.${pascal(group.name)}.(type) {`, "case nil:");
        for (const alternative of group.fieldsArray) {
          const variant = `${id}_${pascal(alternative.name)}`;
          out.push(`case ${variant}:`); write(alternative, "item.Value");
          out.push(`case *${variant}:`, `if item == nil { return nil, errors.New(${JSON.stringify(`Invalid protobuf ${id}.${group.name}`)}) }`); write(alternative, "item.Value");
        }
        out.push(`default: return nil, errors.New(${JSON.stringify(`Invalid protobuf ${id}.${group.name}`)})`, "}");
      } else {
        const access = `value.${pascal(field.name)}`;
        if (field.repeated) {
          if (required(field)) out.push(`if ${access} == nil { return nil, errors.New(${JSON.stringify(`Missing ${id}.${field.name}`)}) }`);
          out.push(`for _, item := range ${access} {`); write(field, "item"); out.push("}");
        } else if (required(field)) { out.push("{"); write(field, access); out.push("}"); }
        else { out.push(`if ${access}.Present {`); write(field, `${access}.Value`); out.push("}"); }
      }
    }
    out.push("return writer.Finish()", "}", "");
  }
  const decoded = new Set<string>();
  function decoder(type: protobuf.Type) {
    const id = name(type); if (decoded.has(id)) return; decoded.add(id); reserve(`Decode${id}`);
    if (groups(type).length) throw new TypeError("Google response oneof decoding needs explicit support");
    if (type.fieldsArray.some(required)) throw new TypeError("Google required response field decoding needs explicit support");
    for (const field of type.fieldsArray) if (field.resolvedType instanceof protobuf.Type) decoder(field.resolvedType);
    out.push(`func Decode${id}(data []byte) (${id}, error) {`, `var value ${id}`, "reader := runtime.NewProtoReader(data)", "for !reader.Done() {", "tag := reader.Uint32()", `if reader.Err() != nil { return ${id}{}, reader.Err() }`, `if tag >> 3 == 0 { return ${id}{}, errors.New("Invalid protobuf field number") }`, "switch tag >> 3 {");
    for (const field of type.fieldsArray) {
      if (field.resolvedType instanceof protobuf.Enum) throw new TypeError("Google response enum decoding is not supported");
      out.push(`case ${field.id}:`, `if tag & 7 != ${wire(field)} { return ${id}{}, errors.New(${JSON.stringify(`Invalid protobuf wire type for ${id}.${field.name}`)}) }`);
      if (field.resolvedType instanceof protobuf.Type) out.push(`nested := reader.Bytes(); if reader.Err() != nil { return ${id}{}, reader.Err() }`, `item, err := Decode${name(field.resolvedType)}(nested); if err != nil { return ${id}{}, err }`);
      else out.push(`item := reader.${pascal(field.type)}()`);
      out.push(field.repeated ? `value.${pascal(field.name)} = append(value.${pascal(field.name)}, item)` : `value.${pascal(field.name)} = runtime.Some(item)`);
    }
    out.push("default: reader.Skip(tag & 7)", "}", "}", `if reader.Err() != nil { return ${id}{}, reader.Err() }`, "return value, nil", "}", "");
  }
  decoder(graph.response);
  out.push(`const StreamingSynthesizePath = ${JSON.stringify(graph.path)}`, `func EncodeStreamingRequest(value ${name(graph.request)}) ([]byte, error) { return Encode${name(graph.request)}(value) }`, `func DecodeStreamingResponse(data []byte) (${name(graph.response)}, error) { return Decode${name(graph.response)}(data) }`, "");
  return out.join("\n");
}
