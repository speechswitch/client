import type { OpenaiContract } from "./openai-contract.ts";
import { pascal, snake } from "./language-types.ts";

function quoted(value: string): string {
  if (!value.isWellFormed()) throw new TypeError("OpenAI Rust strings require valid Unicode");
  return JSON.stringify(value).replace(/\\(?:u([0-9a-f]{4})|b|f|[\s\S])/gi, (escape, hex: string | undefined) => hex ? `\\u{${hex}}` : escape === "\\b" ? "\\u{8}" : escape === "\\f" ? "\\u{c}" : escape);
}

/** Owned concrete wire types, codecs and HTTP call from the audited speech graph. */
export function renderOpenaiRustClient(contract: OpenaiContract): string {
  const declarations: string[] = [], functions: string[] = [];
  const names = new Set(["SpeechRequest", "SpeechEvent"]), codecs = new Set([...names].map(snake));
  const references = new Map<string, string>();
  function reserve(stem: string): string {
    let name = stem;
    for (let n = 2; names.has(name) || codecs.has(snake(name)); n++) name = stem + n;
    names.add(name); codecs.add(snake(name)); return name;
  }
  function compile(raw: unknown, name: string, depth = 0): string {
    if (depth > 50) throw new TypeError("OpenAI schema graph is too deep");
    const schema = raw as Record<string, unknown>;
    if (typeof schema.$ref === "string") {
      const previous = references.get(schema.$ref); if (previous) return previous;
      const keys = schema.$ref.slice(2).split("/").map(key => key.replace(/~1/g, "/").replace(/~0/g, "~"));
      const target = reserve(pascal(keys.at(-1)!)); references.set(schema.$ref, target);
      return compile(keys.reduce((node, key) => (node as Record<string, unknown>)[key], contract.document as unknown), target, depth + 1);
    }
    let decode: string, encode: string;
    if (Array.isArray(schema.anyOf)) {
      const parts = schema.anyOf.map((child, index) => ({ index, type: compile(child, reserve(name + "Variant" + index), depth + 1) }));
      declarations.push(`#[derive(Debug, Clone, PartialEq)]
pub enum ${name} { ${parts.map(p => `Variant${p.index}(${p.type}),`).join(" ")} }
impl Default for ${name} { fn default() -> Self { Self::Variant0(Default::default()) } }`);
      decode = parts.map(p => `if let Ok(item) = read_${snake(p.type)}(value) { return Ok(${name}::Variant${p.index}(item)); }`).join("\n") + "\nErr(Error)";
      encode = `match value { ${parts.map(p => `${name}::Variant${p.index}(item) => write_${snake(p.type)}(item, output),`).join("\n")} }`;
    } else if (schema.type === "object") {
      const required = (schema.required ?? []) as string[], fieldNames = new Set(["extra"]);
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
${extra ? "/// Additional fields preserve validated raw JSON.\npub extra: std::collections::BTreeMap<String, String>," : ""}
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
    } else {
      const type = schema.type === "string" ? "String" : schema.type === "boolean" ? "bool" : "f64";
      declarations.push(`pub type ${name} = ${type};`);
      const checks: string[] = [];
      if (type === "f64") checks.push("value.is_finite()");
      if (schema.type === "integer") checks.push("value.fract() == 0.0", "value.abs() <= 9007199254740991_f64");
      for (const [key, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
        if (schema[key] !== undefined) checks.push(`${key.endsWith("Length") ? "value.chars().count()" : "*value"} ${operator} ${schema[key]}${key.endsWith("Length") ? "" : "_f64"}`);
      }
      if (Array.isArray(schema.enum)) checks.push(`(${schema.enum.map(v => type === "String" ? `value == ${quoted(v as string)}` : `*value == ${v}${type === "f64" ? "_f64" : ""}`).join(" || ")})`);
      functions.push(`fn check_${snake(name)}(value: &${name}) -> Result<(), Error> { ${checks.length ? `if !(${checks.join(" && ")}) { return Err(Error); }` : "let _ = value;"} Ok(()) }`);
      decode = `let result = value.${type === "String" ? "string" : type === "bool" ? "boolean" : "number"}()?; check_${snake(name)}(&result)?; Ok(result)`;
      encode = `check_${snake(name)}(value)?; ${type === "String" ? "json::quote(value, output);" : "output.push_str(&value.to_string());"} Ok(())`;
    }
    functions.push(`fn read_${snake(name)}(value: Raw<'_>) -> Result<${name}, Error> {\n${decode}\n}\nfn write_${snake(name)}(value: &${name}, output: &mut String) -> Result<(), Error> {\n${encode}\n}`);
    return name;
  }
  const input = compile(contract.input, "SpeechRequest"), event = compile(contract.event, "SpeechEvent");
  if (input !== "SpeechRequest") declarations.push(`pub type SpeechRequest = ${input};`);
  if (event !== "SpeechEvent") declarations.push(`pub type SpeechEvent = ${event};`);
  return `// Generated by codegen/generate-clients.ts from ${contract.sourceUrl}. Do not edit.
#![allow(dead_code)]
use crate::{endpoint, http::{HttpRequest, HttpResponse, HttpTransport, TransportError}, json::{self, Error, Raw}};
pub const DEFAULT_BASE_URL: &str = ${quoted(contract.baseUrl)};
pub const SPEECH_STATUS: u16 = ${contract.status};
fn failure(message: &str) -> TransportError { std::io::Error::new(std::io::ErrorKind::InvalidData, message).into() }

${declarations.join("\n\n")}
${functions.join("\n\n")}

pub fn decode_speech_event(text: &str) -> Result<SpeechEvent, TransportError> {
Raw::parse_exact(text).and_then(read_${snake(event)}).map_err(|_| failure("Invalid OpenAI speech event"))
}
pub async fn create_speech(value: &SpeechRequest, api_key: &str, base_url: &str, transport: &dyn HttpTransport) -> Result<HttpResponse, TransportError> {
let mut body = String::new();
write_${snake(input)}(value, &mut body).map_err(|_| failure("Invalid OpenAI speech wire request"))?;
let url = endpoint::append(base_url, ${quoted(contract.path)}).ok_or_else(|| failure("Invalid OpenAI base_url"))?;
transport.send(HttpRequest { method: ${quoted(contract.method.toUpperCase())}.into(), url,
headers: vec![("Authorization".into(), format!("Bearer {api_key}")), ("Content-Type".into(), "application/json".into()), ("Accept".into(), "application/octet-stream, text/event-stream".into())], body: body.into_bytes() }).await
}
`;
}
