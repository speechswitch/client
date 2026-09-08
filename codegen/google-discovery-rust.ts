import { pascal, snake } from "./language-types.ts";
import { parseGoogleDiscovery, type GoogleDiscoverySchema } from "./google-discovery.ts";

function quoted(value: string): string {
  if (!value.isWellFormed()) throw new TypeError("Rust Discovery strings require valid Unicode");
  return JSON.stringify(value).replace(/\\(?:u([0-9a-f]{4})|b|f|[\s\S])/gi, (escape, hex: string | undefined) => hex ? `\\u{${hex}}` : escape === "\\b" ? "\\u{8}" : escape === "\\f" ? "\\u{c}" : escape);
}

/** Resolve the selected Discovery graph into concrete Rust types and operations. */
export function renderGoogleDiscoveryRust(raw: unknown, sourceUrl: string): string {
  const { document, methods } = parseGoogleDiscovery(raw);
  const nodes = new Map<string, GoogleDiscoverySchema>();
  const names = new Map<GoogleDiscoverySchema, string>();
  const active = new Set<GoogleDiscoverySchema>();
  const identifiers = new Set(["String", "Vec", "Option", "Result", "Error", "Raw", "ClientOptions", "HttpRequest", "HttpResponse", "HttpTransport", "TransportError", "DEFAULT_BASE_URL", ...methods.flatMap(method => [snake(method.name), `decode_${snake(method.name)}_response`])]);
  function reserve(id: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || identifiers.has(id)) throw new TypeError(`Colliding or invalid Rust Discovery identifier: ${id}`);
    identifiers.add(id);
  }
  function add(schema: GoogleDiscoverySchema, suggested: string): string {
    if (active.has(schema)) throw new TypeError(`Recursive Rust Discovery schema: ${suggested}`);
    if (schema.$ref) {
      const target = document.schemas[schema.$ref];
      if (!target) throw new TypeError(`Unresolved Google Discovery reference: ${schema.$ref}`);
      active.add(schema);
      const id = add(target, pascal(schema.$ref));
      active.delete(schema); return id;
    }
    const previous = names.get(schema); if (previous) return previous;
    reserve(suggested); reserve(`read_${snake(suggested)}`); reserve(`write_${snake(suggested)}`);
    nodes.set(suggested, schema); names.set(schema, suggested); active.add(schema);
    if (schema.enum) {
      if (schema.type !== "string" || !schema.enum.length || !schema.enum.every(value => typeof value === "string")) throw new TypeError("Invalid Google Discovery enum");
      if (new Set(schema.enum.map(value => pascal(snake(value)))).size !== schema.enum.length) throw new TypeError(`Rust Discovery enum variant collision: ${suggested}`);
    } else switch (schema.type) {
      case "string": case "boolean": case "number": break;
      case "integer":
        if (schema.format !== undefined && !["int32", "int64"].includes(schema.format)) throw new TypeError(`Unsupported Rust Discovery integer format: ${schema.format}`);
        break;
      case "array":
        if (!schema.items) throw new TypeError("Google Discovery array lacks item schema");
        add(schema.items, suggested + "Item"); break;
      case "object":
        if (schema.additionalProperties) {
          if (schema.properties) throw new TypeError("Google Discovery mixed map/object schemas need explicit support");
          add(schema.additionalProperties, suggested + "Value");
        } else {
          if (!schema.properties) throw new TypeError("Google Discovery object lacks properties");
          if (schema.required?.some(key => !Object.hasOwn(schema.properties!, key))) throw new TypeError(`Unknown required Google Discovery field: ${suggested}`);
          const fields = new Set<string>();
          for (const [key, field] of Object.entries(schema.properties).sort(([a], [b]) => a.localeCompare(b))) {
            const id = snake(key);
            if (fields.has(id)) throw new TypeError(`Rust Discovery field collision: ${suggested}.${key}`);
            fields.add(id); add(field, suggested + pascal(key));
          }
        }
        break;
      default: throw new TypeError(`Unsupported Google Discovery type: ${schema.type}`);
    }
    active.delete(schema); return suggested;
  }
  const operations = methods.map(method => {
    const input: GoogleDiscoverySchema = method.wire.request ?? { type: "object", properties: Object.fromEntries(Object.entries(method.wire.parameters ?? {}).map(([key, field]) => [key, { type: field.type, enum: field.enum }])), required: Object.entries(method.wire.parameters ?? {}).filter(([, field]) => field.required).map(([key]) => key) };
    if (!method.wire.response.$ref) throw new TypeError("Google Discovery method response must reference a named schema");
    return { ...method, input: add(input, pascal(method.name) + "Input"), response: add(method.wire.response, pascal(method.name) + "Response") };
  });
  const name = (schema: GoogleDiscoverySchema): string => schema.$ref ? name(document.schemas[schema.$ref]!) : names.get(schema)!;
  const out: string[] = [];
  for (const [id, schema] of nodes) {
    let encode: string; let decode: string;
    if (schema.enum) {
      const variants = schema.enum.map(value => ({ value, id: pascal(snake(value)) }));
      out.push("#[derive(Debug, Clone, Copy, PartialEq, Eq)]", `pub enum ${id} { ${variants.map(value => `${value.id},`).join(" ")} }`, `impl ${id} { fn as_str(&self) -> &'static str { match self { ${variants.map(value => `Self::${value.id} => ${quoted(value.value)},`).join(" ")} } } }`);
      encode = "json::quote(value.as_str(), output); Ok(())";
      decode = `match value.string()?.as_str() { ${variants.map(value => `${quoted(value.value)} => Ok(${id}::${value.id}),`).join(" ")} _ => Err(Error) }`;
    } else if (schema.type === "object" && schema.properties) {
      const fields = Object.entries(schema.properties).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => ({ key, field: snake(key), type: name(field), required: schema.required?.includes(key) === true }));
      out.push(`#[derive(Debug, Clone, PartialEq${fields.every(field => !field.required) ? ", Default" : ""})]`, `pub struct ${id} {\n${fields.map(field => `pub ${field.field}: ${field.required ? field.type : `Option<${field.type}>`},`).join("\n")}\n}`);
      decode = `let ${fields.length ? "mut " : ""}fields = value.object()?;${fields.length ? "" : " let _ = fields;"}\nOk(${id} {\n${fields.map(field => `${field.field}: ${field.required ? `read_${snake(field.type)}(fields.remove(${quoted(field.key)}).ok_or(Error)?)?` : `fields.remove(${quoted(field.key)}).map(read_${snake(field.type)}).transpose()?`},`).join("\n")}\n})`;
      encode = `output.push('{');${fields.length ? "" : " let _ = value;"}\n${fields.map(field => `${field.required ? "{" : `if let Some(item) = &value.${field.field} {`}\nif !output.ends_with('{') { output.push(','); } json::quote(${quoted(field.key)}, output); output.push(':'); write_${snake(field.type)}(${field.required ? `&value.${field.field}` : "item"}, output)?;\n}`).join("\n")}\noutput.push('}'); Ok(())`;
    } else if (schema.type === "object") {
      const child = name(schema.additionalProperties!);
      out.push(`pub type ${id} = std::collections::BTreeMap<String, ${child}>;`);
      encode = `output.push('{'); for (index, (key, item)) in value.iter().enumerate() { if index != 0 { output.push(','); } json::quote(key, output); output.push(':'); write_${snake(child)}(item, output)?; } output.push('}'); Ok(())`;
      decode = `value.object()?.into_iter().map(|(key, item)| Ok((key, read_${snake(child)}(item)?))).collect()`;
    } else if (schema.type === "array") {
      const child = name(schema.items!);
      out.push(`pub type ${id} = Vec<${child}>;`);
      encode = `output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_${snake(child)}(item, output)?; } output.push(']'); Ok(())`;
      decode = `value.array()?.into_iter().map(read_${snake(child)}).collect()`;
    } else {
      const type = schema.type === "string" ? "String" : schema.type === "boolean" ? "bool" : schema.type === "number" ? "f64" : schema.format === "int32" ? "i32" : schema.format === "int64" ? "i64" : "crate::runtime::BigInt";
      out.push(`pub type ${id} = ${type};`);
      encode = `${type === "f64" ? "if !value.is_finite() { return Err(Error); } " : ""}${type === "String" ? "json::quote(value, output);" : "output.push_str(&value.to_string());"} Ok(())`;
      decode = type === "String" ? "value.string()" : type === "bool" ? "value.boolean()" : type === "f64" ? "let number = value.number()?; if number.is_finite() { Ok(number) } else { Err(Error) }" : "value.text().parse().map_err(|_| Error)";
    }
    out.push(`fn write_${snake(id)}(value: &${id}, output: &mut String) -> Result<(), Error> {\n${encode}\n}`, `fn read_${snake(id)}(value: Raw<'_>) -> Result<${id}, Error> {\n${decode}\n}`, "");
  }
  for (const operation of operations) {
    const parameters = Object.entries(operation.wire.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b));
    out.push(`pub async fn ${snake(operation.name)}(value: &${operation.input}, options: ClientOptions<'_>) -> Result<HttpResponse, TransportError> {`);
    if (operation.wire.request) out.push("let mut body = String::new();", `write_${snake(operation.input)}(value, &mut body).map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, ${quoted(`Invalid Google ${operation.name} input`)}))?;`);
    else if (!parameters.length) out.push("let _ = value;");
    out.push(`let ${parameters.length ? "mut " : ""}url = endpoint::append(options.base_url, ${quoted("/" + operation.wire.path)}).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid Google HTTP endpoint URL"))?;`);
    for (const [key, field] of parameters) {
      const access = field.required ? `&value.${snake(key)}` : "item";
      out.push(field.required ? "{" : `if let Some(item) = &value.${snake(key)} {`);
      if (field.type === "number") out.push(`if !(${access}).is_finite() { return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, ${quoted(`Invalid Google ${operation.name} input`)}).into()); }`);
      out.push(`endpoint::set_query(&mut url, ${quoted(key)}, ${field.enum || field.type === "string" ? `(${access}).as_str()` : `&(${access}).to_string()`}).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid Google query string"))?;`, "}");
    }
    out.push(`let ${operation.wire.request ? "mut " : ""}headers = options.headers.to_vec();`);
    if (operation.wire.request) out.push('headers.retain(|(key, _)| !key.eq_ignore_ascii_case("content-type"));', 'headers.push(("content-type".into(), "application/json".into()));');
    out.push(`options.transport.send(HttpRequest { method: ${quoted(operation.wire.httpMethod)}.into(), url, headers, body: ${operation.wire.request ? "body.into_bytes()" : "Vec::new()"} }).await`, "}");
    out.push(`pub fn decode_${snake(operation.name)}_response(data: &[u8]) -> Result<${operation.response}, TransportError> {`,
      `let decode = || -> Result<${operation.response}, Error> { let text = std::str::from_utf8(data).map_err(|_| Error)?; read_${snake(operation.response)}(Raw::parse_exact(text)?) };`,
      `decode().map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, ${quoted(`Invalid Google ${operation.name} response`)}).into())`, "}", "");
  }
  return `// Generated from ${sourceUrl}. Do not edit.\n#![allow(dead_code)]\nuse crate::{endpoint, http::{HttpRequest, HttpResponse, HttpTransport, TransportError}, json::{self, Error, Raw}};\n\npub const DEFAULT_BASE_URL: &str = ${quoted(document.rootUrl)};\npub struct ClientOptions<'a> { pub base_url: &'a str, pub headers: &'a [(String, String)], pub transport: &'a dyn HttpTransport }\n\n${out.join("\n").trimEnd()}\n`;
}
