import type { LovoContract } from "./lovo-contract.ts";
import { pascal, snake } from "./language-types.ts";

function quoted(value: string): string {
  if (!value.isWellFormed()) throw new TypeError("LOVO Rust strings require valid Unicode");
  return JSON.stringify(value).replace(/\\(?:u([0-9a-f]{4})|b|f|[\s\S])/gi, (escape, hex: string | undefined) => hex ? `\\u{${hex}}` : escape === "\\b" ? "\\u{8}" : escape === "\\f" ? "\\u{c}" : escape);
}

/** Owned concrete codecs and operations from the validated selected OpenAPI graph. */
export function renderLovoRustClient(contract: LovoContract): string {
  const declarations: string[] = [], functions: string[] = [], operations: string[] = [];
  const names = new Set(contract.operations.flatMap(op => [pascal(op.name) + "Input", pascal(op.name) + "Response"]));
  const codecs = new Set([...names].map(snake));
  const references = new Map<string, string>();
  function reserve(stem: string): string {
    let name = stem;
    for (let n = 2; names.has(name) || codecs.has(snake(name)); n++) name = stem + n;
    names.add(name); codecs.add(snake(name)); return name;
  }
  function compile(raw: unknown, name: string, depth = 0): string {
    if (depth > 50) throw new TypeError("LOVO schema graph is too deep");
    const schema = raw as Record<string, unknown>;
    if (typeof schema.$ref === "string") {
      const ref = schema.$ref.split("/").at(-1)!;
      const previous = references.get(ref); if (previous) return previous;
      const target = reserve(pascal(ref)); references.set(ref, target);
      return compile(contract.schemas[ref], target, depth + 1);
    }
    let decode: string, encode: string;
    if (schema.nullable === true) {
      const target = compile({ ...schema, nullable: false }, reserve(name + "Value"), depth + 1);
      declarations.push(`pub type ${name} = Option<${target}>;`);
      decode = `if value.is_null() { Ok(None) } else { read_${snake(target)}(value).map(Some) }`;
      encode = `match value { Some(value) => write_${snake(target)}(value, output), None => { output.push_str("null"); Ok(()) } }`;
    } else if (schema.type === "object") {
      const required = (schema.required ?? []) as string[];
      const fieldNames = new Set(["extra"]);
      const fields = Object.entries(schema.properties as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => {
        const stem = snake(key); let field = stem;
        for (let n = 2; fieldNames.has(field); n++) field = stem + n;
        fieldNames.add(field);
        return { key, field, type: compile(child, reserve(name + pascal(key)), depth + 1), required: required.includes(key) };
      });
      const extra = schema.additionalProperties !== false;
      declarations.push(`#[derive(Debug, Clone, Default, PartialEq)]
pub struct ${name} {
${fields.map(f => `pub ${f.field}: ${f.required ? f.type : `Option<${f.type}>`},`).join("\n")}
${extra ? "/// Additional properties retain their validated raw JSON.\npub extra: std::collections::BTreeMap<String, String>," : ""}
}`);
      decode = `let ${fields.length ? "mut " : ""}fields = value.object()?;
let result = ${name} {
${fields.map(f => `${f.field}: ${f.required ? `read_${snake(f.type)}(fields.remove(${quoted(f.key)}).ok_or(Error)?)?` : `fields.remove(${quoted(f.key)}).map(read_${snake(f.type)}).transpose()?`},`).join("\n")}
${extra ? "extra: fields.into_iter().map(|(key, value)| (key, value.text().to_owned())).collect()," : ""}
};
${extra ? "" : "if !fields.is_empty() { return Err(Error); }"}
Ok(result)`;
      const prefix = (key: string) => `if !output.ends_with('{') { output.push(','); } json::quote(${key}, output); output.push(':');`;
      encode = `output.push('{');
${fields.map(f => f.required ? `${prefix(quoted(f.key))} write_${snake(f.type)}(&value.${f.field}, output)?;` : `if let Some(item) = &value.${f.field} { ${prefix(quoted(f.key))} write_${snake(f.type)}(item, output)?; }`).join("\n")}
${extra ? `for (key, item) in &value.extra {
${fields.length ? `if matches!(key.as_str(), ${fields.map(f => quoted(f.key)).join(" | ")}) { return Err(Error); }` : ""}
Raw::parse_exact(item)?; ${prefix("key")} output.push_str(item);
}` : ""}
output.push('}'); Ok(())`;
    } else if (schema.type === "array") {
      const item = compile(schema.items, reserve(name + "Item"), depth + 1);
      declarations.push(`pub type ${name} = Vec<${item}>;`);
      decode = `value.array()?.into_iter().map(read_${snake(item)}).collect()`;
      encode = `output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_${snake(item)}(item, output)?; } output.push(']'); Ok(())`;
    } else {
      const type = schema.type === "string" ? "String" : schema.type === "boolean" ? "bool" : "f64";
      declarations.push(`pub type ${name} = ${type};`);
      const checks: string[] = [];
      if (type === "f64") checks.push("value.is_finite()");
      if (schema.type === "integer") checks.push("value.fract() == 0.0", "value.abs() <= 9007199254740991_f64");
      for (const [key, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
        if (schema[key] !== undefined) checks.push(`${key.endsWith("Length") ? "value.chars().count()" : "*value"} ${operator} ${schema[key]}${key.endsWith("Length") ? "" : "_f64"}`);
      }
      if (schema.enum !== undefined) checks.push(`(${(schema.enum as unknown[]).map(v => type === "String" ? `value == ${quoted(v as string)}` : `*value == ${v}${type === "f64" ? "_f64" : ""}`).join(" || ")})`);
      functions.push(`fn check_${snake(name)}(value: &${name}) -> Result<(), Error> { ${checks.length ? `if !(${checks.join(" && ")}) { return Err(Error); }` : "let _ = value;"} Ok(()) }`);
      decode = `let result = value.${type === "String" ? "string" : type === "bool" ? "boolean" : "number"}()?; check_${snake(name)}(&result)?; Ok(result)`;
      encode = `check_${snake(name)}(value)?; ${type === "String" ? "json::quote(value, output);" : "output.push_str(&value.to_string());"} Ok(())`;
    }
    functions.push(`fn read_${snake(name)}(value: Raw<'_>) -> Result<${name}, Error> {\n${decode}\n}\nfn write_${snake(name)}(value: &${name}, output: &mut String) -> Result<(), Error> {\n${encode}\n}`);
    return name;
  }
  for (const op of contract.operations) {
    const name = pascal(op.name), method = snake(op.name);
    const input = compile(op.input, name + "Input"), output = compile(op.output, name + "Response");
    if (input !== name + "Input") declarations.push(`pub type ${name}Input = ${input};`);
    if (output !== name + "Response") declarations.push(`pub type ${name}Response = ${output};`);
    const route = op.parameters.reduce((route, p) => `${route}.replace(${quoted("{" + p + "}")}, &segment(&value.${snake(p)}))`, quoted(op.path));
    operations.push(`pub const ${method.toUpperCase()}_STATUS: u16 = ${op.status};
pub fn decode_${method}(text: &str) -> Result<${name}Response, TransportError> {
Raw::parse_exact(text).and_then(read_${snake(output)}).map_err(|_| failure(${quoted("Invalid LOVO " + op.id + " response")}))
}
pub async fn ${method}(value: &${name}Input, api_key: &str, base_url: &str, transport: &dyn HttpTransport) -> Result<HttpResponse, TransportError> {
let mut body = String::new();
write_${snake(input)}(value, &mut body).map_err(|_| failure(${quoted("Invalid LOVO " + op.id + " request")}))?;
let url = endpoint::append(base_url, &(${route})).ok_or_else(|| failure("Invalid LOVO BaseURL"))?;
transport.send(HttpRequest { method: ${quoted(op.method.toUpperCase())}.into(), url,
headers: vec![(${quoted(op.header)}.into(), api_key.into())${op.body ? ', ("content-type".into(), "application/json".into())' : ""}],
body: ${op.body ? "body.into_bytes()" : "Vec::new()"} }).await
}`);
  }
  return `// Generated by codegen/generate-clients.ts from ${contract.sourceUrl}. Do not edit.
#![allow(dead_code)]
use crate::{endpoint, http::{HttpRequest, HttpResponse, HttpTransport, TransportError}, json::{self, Error, Raw}};
pub const DEFAULT_BASE_URL: &str = ${quoted(contract.baseUrl)};
fn failure(message: &str) -> TransportError { std::io::Error::new(std::io::ErrorKind::InvalidData, message).into() }
fn segment(value: &str) -> String {
let mut result = String::new();
for byte in value.bytes() { match byte {
b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => result.push(byte as char),
_ => { use std::fmt::Write; write!(&mut result, "%{byte:02X}").unwrap(); }
} } result
}
${declarations.join("\n\n")}
${functions.join("\n\n")}
${operations.join("\n\n")}
`;
}
