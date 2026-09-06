import type { CambContract } from "./camb-contract.ts";
import { pascal, snake } from "./language-types.ts";

type Schema = Record<string, unknown>;
type Resolver = (value: unknown) => Schema;
function quoted(value: string): string {
  if (!value.isWellFormed()) throw new TypeError("CAMB Rust strings require valid Unicode");
  return JSON.stringify(value).replace(/\\(?:u([0-9a-f]{4})|b|f|[\s\S])/gi, (escape, hex: string | undefined) => hex ? `\\u{${hex}}` : escape === "\\b" ? "\\u{8}" : escape === "\\f" ? "\\u{c}" : escape);
}
function number(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("CAMB Rust numeric bounds must be finite");
  return `${value}_f64`;
}

/** Specialized owned wire types/codecs; no runtime schema graph is emitted. */
export function renderCambRustClient(contract: CambContract): string {
  const declarations: string[] = [];
  const functions: string[] = [];
  const names = new Set(["HttpInput", "ClientMessage", "ServerMessage", ...contract.messages.keys()]);
  const codecNames = new Set([...names].map(snake));
  if (codecNames.size !== names.size) throw new TypeError("CAMB Rust root codec names collide");
  function nested(parent: string, key: string): string {
    const stem = parent + pascal(key);
    let name = stem;
    for (let suffix = 2; names.has(name) || codecNames.has(snake(name)); suffix++) name = stem + suffix;
    names.add(name);
    codecNames.add(snake(name));
    return name;
  }
  function compile(resolve: Resolver, value: unknown, name: string, depth = 0): string {
    if (depth > 50) throw new TypeError("CAMB schema graph is too deep or recursive");
    const schema = resolve(value);
    const nullable = schema.nullable === true || (Array.isArray(schema.anyOf) && schema.anyOf.length === 2 && schema.anyOf.some(part => resolve(part).type === "null"));
    const read = (type: string, value: string) => `read_${snake(type)}(${value})`;
    const write = (type: string, value: string) => `write_${snake(type)}(${value}, output)`;
    let decode: string;
    let encode: string;
    if (nullable) {
      const inner = schema.nullable === true ? { ...schema, nullable: false } : (schema.anyOf as unknown[]).find(part => resolve(part).type !== "null");
      const target = compile(resolve, inner, nested(name, "Value"), depth + 1);
      declarations.push(`pub type ${name} = Option<${target}>;`);
      decode = `if value.is_null() { Ok(None) } else { ${read(target, "value")}.map(Some) }`;
      encode = `match value { Some(value) => ${write(target, "value")}, None => { output.push_str("null"); Ok(()) } }`;
    } else if (Array.isArray(schema.anyOf)) {
      const variants = schema.anyOf.map((child, index) => compile(resolve, child, nested(name, `Variant${index}`), depth + 1));
      declarations.push(`#[derive(Debug, Clone, PartialEq)]\npub enum ${name} {\n${variants.map((variant, index) => `Variant${index}(${variant}),`).join("\n")}\n}\nimpl Default for ${name} { fn default() -> Self { Self::Variant0(Default::default()) } }`);
      decode = `${variants.map((variant, index) => `if let Ok(value) = ${read(variant, "value")} { return Ok(${name}::Variant${index}(value)); }`).join("\n")}\nErr(Error)`;
      encode = `match value { ${variants.map((variant, index) => `${name}::Variant${index}(value) => ${write(variant, "value")},`).join("\n")} }`;
    } else if (schema.type === "object") {
      const properties = (schema.properties ?? {}) as Schema;
      const required = (schema.required ?? []) as string[];
      const fieldNames = new Set(["extra"]);
      const fields = Object.entries(properties).map(([key, child]) => {
        const stem = snake(key);
        let field = stem;
        for (let suffix = 2; fieldNames.has(field); suffix++) field = stem + suffix;
        fieldNames.add(field);
        return { key, field, type: compile(resolve, child, nested(name, key), depth + 1), required: required.includes(key) };
      });
      const extra = schema.additionalProperties !== false;
      declarations.push(`#[derive(Debug, Clone, Default, PartialEq)]\npub struct ${name} {\n${fields.map(field => `pub ${field.field}: ${field.required ? field.type : `Option<${field.type}>`},`).join("\n")}${extra ? "\n/// Additional properties as validated raw JSON, preserving forward-compatible values.\npub extra: std::collections::BTreeMap<String, String>," : ""}\n}`);
      decode = `let ${fields.length ? "mut " : ""}fields = value.object()?;
let result = ${name} {
${fields.map(field => `${field.field}: ${field.required ? `${read(field.type, `fields.remove(${quoted(field.key)}).ok_or(Error)?`)}?` : `fields.remove(${quoted(field.key)}).map(read_${snake(field.type)}).transpose()?`},`).join("\n")}
${extra ? "extra: fields.into_iter().map(|(key, value)| (key, value.text().to_owned())).collect()," : ""}
};
${extra ? "" : "if !fields.is_empty() { return Err(Error); }"}
Ok(result)`;
      const prefix = (key: string) => `if !output.ends_with('{') { output.push(','); } json::quote(${key}, output); output.push(':');`;
      encode = `output.push('{');
${fields.map(field => field.required
        ? `${prefix(quoted(field.key))} ${write(field.type, `&value.${field.field}`)}?;`
        : `if let Some(item) = &value.${field.field} { ${prefix(quoted(field.key))} ${write(field.type, "item")}?; }`).join("\n")}
${extra ? `for (key, item) in &value.extra {
${fields.length ? `if matches!(key.as_str(), ${fields.map(field => quoted(field.key)).join(" | ")}) { return Err(Error); }` : ""}
Raw::parse_exact(item)?;
${prefix("key")} output.push_str(item);
}` : ""}
output.push('}'); Ok(())`;
    } else if (schema.type === "array") {
      const item = compile(resolve, schema.items, nested(name, "Item"), depth + 1);
      declarations.push(`pub type ${name} = Vec<${item}>;`);
      decode = `value.array()?.into_iter().map(read_${snake(item)}).collect()`;
      encode = `output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } ${write(item, "item")}?; } output.push(']'); Ok(())`;
    } else if (schema.type === "null") {
      declarations.push(`pub type ${name} = ();`);
      decode = "if value.is_null() { Ok(()) } else { Err(Error) }";
      encode = "let _ = value; output.push_str(\"null\"); Ok(())";
    } else if (schema.type === "string" && schema.format === "binary") {
      if (depth !== 0) throw new TypeError("CAMB Rust binary data requires a message boundary");
      declarations.push(`pub type ${name} = Vec<u8>;`);
      return name;
    } else {
      const type = schema.type === "string" ? "String" : schema.type === "boolean" ? "bool" : "f64";
      declarations.push(`pub type ${name} = ${type};`);
      const checks = (variable: string) => {
        const conditions: string[] = [];
        if (type === "f64") conditions.push(`${variable}.is_finite()`);
        if (schema.type === "integer") conditions.push(`${variable}.fract() == 0.0`);
        for (const [keyword, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
          if (schema[keyword] !== undefined) conditions.push(`${keyword.endsWith("Length") ? `${variable}.chars().count()` : `*${variable}`} ${operator} ${keyword.endsWith("Length") ? schema[keyword] : number(schema[keyword])}`);
        }
        if (schema.enum !== undefined || "const" in schema) {
          const values = ("const" in schema ? [schema.const] : schema.enum) as unknown[];
          if (values.some(value => typeof value !== (type === "f64" ? "number" : type === "bool" ? "boolean" : "string"))) throw new TypeError("CAMB Rust literal does not match its scalar type");
          if (type === "String") conditions.push(`matches!(${variable}.as_str(), ${values.map(value => quoted(value as string)).join(" | ")})`);
          else conditions.push(`(${values.map(value => `*${variable} == ${type === "f64" ? number(value) : String(value)}`).join(" || ")})`);
        }
        return conditions.length ? `if !(${conditions.join(" && ")}) { return Err(Error); }` : "";
      };
      functions.push(`fn check_${snake(name)}(value: &${name}) -> Result<(), Error> { ${checks("value")} let _ = value; Ok(()) }`);
      decode = `let result = value.${type === "String" ? "string" : type === "bool" ? "boolean" : "number"}()?; check_${snake(name)}(&result)?; Ok(result)`;
      encode = `check_${snake(name)}(value)?; ${type === "String" ? "json::quote(value, output);" : "output.push_str(&value.to_string());"} Ok(())`;
    }
    functions.push(`fn read_${snake(name)}(value: Raw<'_>) -> Result<${name}, Error> {\n${decode}\n}`);
    functions.push(`fn write_${snake(name)}(value: &${name}, output: &mut String) -> Result<(), Error> {\n${encode}\n}`);
    return name;
  }
  compile(contract.http, contract.input, "HttpInput");
  const binary = (name: string) => { const schema = contract.live(contract.messages.get(name)); return schema.type === "string" && schema.format === "binary"; };
  for (const [name, schema] of contract.messages) compile(contract.live, schema, name);
  if (contract.groups[0]!.some(binary)) throw new TypeError("CAMB Rust client messages must be JSON");
  const audio = contract.groups[1]!.filter(binary);
  if (audio.length !== 1) throw new TypeError("Expected one CAMB binary audio message");
  return `// Generated by codegen/generate-clients.ts from ${contract.urls.join(" and ")}. Do not edit.
#![allow(dead_code)]
use crate::{endpoint, http::{HttpRequest, HttpResponse, HttpTransport, TransportError}, json::{self, Error, Raw}, websocket::Message};

pub const DEFAULT_BASE_URL: &str = ${quoted(contract.baseUrl)};
pub const DEFAULT_WEB_SOCKET_URL: &str = ${quoted(contract.webSocketUrl)};

${declarations.join("\n\n")}

${["ClientMessage", "ServerMessage"].map((name, index) => `#[derive(Debug, Clone, PartialEq)]\npub enum ${name} { ${contract.groups[index]!.map(variant => `${variant}(${variant}),`).join("\n")} }`).join("\n")}

${functions.join("\n\n")}

pub fn parse_http_input(text: &str) -> Result<HttpInput, Error> { read_http_input(Raw::parse_exact(text)?) }
pub fn encode_http_input(value: &HttpInput) -> Result<String, Error> { let mut output = String::new(); write_http_input(value, &mut output)?; Ok(output) }
pub fn encode_message(value: &ClientMessage) -> Result<String, Error> {
let mut output = String::new();
match value { ${contract.groups[0]!.map(name => `ClientMessage::${name}(value) => write_${snake(name)}(value, &mut output)?,`).join("\n")} }
Ok(output)
}
pub fn decode_message(value: Message) -> Result<ServerMessage, Error> {
let text = match value { Message::Binary(value) => return Ok(ServerMessage::${audio[0]}(value)), Message::Text(text) => text };
let value = Raw::parse_exact(&text)?;
${contract.groups[1]!.filter(name => !binary(name)).map(name => `if let Ok(value) = read_${snake(name)}(value) { return Ok(ServerMessage::${name}(value)); }`).join("\n")}
Err(Error)
}
pub async fn stream_speech(value: &HttpInput, api_key: &str, base_url: &str, transport: &dyn HttpTransport) -> Result<HttpResponse, TransportError> {
let body = encode_http_input(value)?;
let url = endpoint::append(base_url, ${quoted(contract.path)}).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid CAMB HTTP endpoint URL"))?;
transport.send(HttpRequest { method: ${quoted(contract.method.toUpperCase())}.into(), url,
headers: vec![(${quoted(contract.header)}.into(), api_key.into()), ("content-type".into(), "application/json".into())], body: body.into_bytes() }).await
}
`;
}
