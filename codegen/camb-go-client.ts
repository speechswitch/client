import type { CambContract } from "./camb-contract.ts";
import { pascal } from "./language-types.ts";

type Schema = Record<string, unknown>;
type Resolver = (value: unknown) => Schema;

/** Emit concrete wire types and specialized decoders from the validated graph. */
export function renderCambGoClient(contract: CambContract): string {
  const declarations: string[] = [];
  const functions: string[] = [];
  const names = new Set(["HttpInput", "ClientMessage", "ServerMessage", ...contract.messages.keys()]);
  const imports = new Set(["bytes", "context", "encoding/json", "errors", "net/http", "net/url", "strings", "unicode/utf8"]);
  function nested(parent: string, key: string): string {
    const stem = parent + pascal(key);
    let name = stem;
    for (let suffix = 2; names.has(name); suffix++) name = stem + suffix;
    names.add(name);
    return name;
  }
  function compile(resolve: Resolver, value: unknown, name: string, depth = 0): string {
    if (depth > 50) throw new TypeError("CAMB schema graph is too deep or recursive");
    const schema = resolve(value);
    const nullable = schema.nullable === true || (Array.isArray(schema.anyOf) && schema.anyOf.length === 2 && schema.anyOf.some(part => resolve(part).type === "null"));
    if (nullable) {
      const inner = schema.nullable === true ? { ...schema, nullable: false } : schema.anyOf instanceof Array ? schema.anyOf.find(part => resolve(part).type !== "null") : undefined;
      const target = compile(resolve, inner, nested(name, "Value"), depth + 1);
      declarations.push(`type ${name} = *${target}`);
      functions.push(`func decode${name}(value any) (${name}, error) {
if value == nil { return nil, nil }
decoded, err := decode${target}(value)
if err != nil { return nil, err }
return &decoded, nil
}
func encode${name}(value ${name}) (any, error) {
if value == nil { return nil, nil }
return encode${target}(*value)
}`);
      return name;
    }
    let body: string;
    let encode: string;
    if (Array.isArray(schema.anyOf)) {
      const variants = schema.anyOf.map((child, index) => compile(resolve, child, nested(name, `Variant${index}`), depth + 1));
      declarations.push(`type ${name} interface { is${name}() }`);
      for (const [index, variant] of variants.entries()) {
        declarations.push(`type ${name}As${index} struct { Value ${variant} }
func (${name}As${index}) is${name}() {}
func (value ${name}As${index}) MarshalJSON() ([]byte, error) { return json.Marshal(value.Value) }`);
      }
      body = `${variants.map((variant, index) => `if decoded, err := decode${variant}(value); err == nil { return ${name}As${index}{Value: decoded}, nil }`).join("\n")}\nreturn nil, errWireValue`;
      encode = `switch value := value.(type) { ${variants.map((variant, index) => `case ${name}As${index}: return encode${variant}(value.Value); case *${name}As${index}: if value != nil { return encode${variant}(value.Value) }`).join("\n")} }; return nil, errWireValue`;
    } else if (schema.type === "object") {
      const properties = (schema.properties ?? {}) as Schema;
      const required = (schema.required ?? []) as string[];
      const fieldNames = new Set(["Extra", "MarshalJSON"]);
      const fields = Object.entries(properties).map(([key, child]) => {
        const stem = pascal(key);
        let field = stem;
        for (let suffix = 2; fieldNames.has(field); suffix++) field = stem + suffix;
        fieldNames.add(field);
        return { key, field, type: compile(resolve, child, nested(name, key), depth + 1), required: required.includes(key) };
      });
      const extra = schema.additionalProperties !== false;
      declarations.push(`type ${name} struct {\n${fields.map(field => `${field.field} ${field.required ? field.type : `runtime.Optional[${field.type}]`}`).join("\n")}${extra ? "\nExtra map[string]any" : ""}\n}`);
      encode = `
object := map[string]any{}
${extra ? `for key, item := range value.Extra { switch key { ${fields.length ? `case ${fields.map(field => JSON.stringify(field.key)).join(", ")}: return nil, errWireValue` : ""} }; object[key] = item }` : ""}
${fields.map(field => `${field.required ? "{" : `if value.${field.field}.Present {`}
item, err := encode${field.type}(value.${field.field}${field.required ? "" : ".Value"})
if err != nil { return nil, err }
object[${JSON.stringify(field.key)}] = item
}`).join("\n")}
return object, nil`;
      functions.push(`func (value ${name}) MarshalJSON() ([]byte, error) {
object, err := encode${name}(value)
if err != nil { return nil, err }
return json.Marshal(object)
}`);
      body = `var result ${name}
object, ok := value.(map[string]any)
if !ok || object == nil { return result, errWireValue }
${fields.map(field => `if raw, present := object[${JSON.stringify(field.key)}]; present {
decoded, err := decode${field.type}(raw)
if err != nil { return result, err }
result.${field.field} = ${field.required ? "decoded" : "runtime.Some(decoded)"}
}${field.required ? " else { return result, errWireValue }" : ""}`).join("\n")}
for key, item := range object {
switch key { ${fields.length ? `case ${fields.map(field => JSON.stringify(field.key)).join(", ")}: continue` : ""} }
${extra ? "if result.Extra == nil { result.Extra = map[string]any{} }; result.Extra[key] = item" : "_ = item; return result, errWireValue"}
}
return result, nil`;
    } else if (schema.type === "array") {
      const item = compile(resolve, schema.items, nested(name, "Item"), depth + 1);
      declarations.push(`type ${name} []${item}`);
      functions.push(`func (value ${name}) MarshalJSON() ([]byte, error) {
items, err := encode${name}(value)
if err != nil { return nil, err }
return json.Marshal(items)
}`);
      encode = `items := make([]any, len(value)); for index, item := range value { encoded, err := encode${item}(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil`;
      body = `items, ok := value.([]any)
if !ok { return nil, errWireValue }
result := make(${name}, len(items))
for index, item := range items { decoded, err := decode${item}(item); if err != nil { return nil, err }; result[index] = decoded }
return result, nil`;
    } else if (schema.type === "null") {
      declarations.push(`type ${name} struct{}`);
      functions.push(`func (${name}) MarshalJSON() ([]byte, error) { return []byte("null"), nil }`);
      body = `if value != nil { return ${name}{}, errWireValue }; return ${name}{}, nil`;
      encode = "return nil, nil";
    } else if (schema.type === "string" && schema.format === "binary") {
      declarations.push(`type ${name} []byte`);
      body = `decoded, ok := value.([]byte); if !ok { return nil, errWireValue }; return ${name}(decoded), nil`;
      encode = "return []byte(value), nil";
    } else {
      const type = schema.type === "string" ? "string" : schema.type === "boolean" ? "bool" : "float64";
      declarations.push(`type ${name} = ${type}`);
      const checks = ["ok"];
      if (type === "string") checks.push("utf8.ValidString(decoded)");
      if (type === "float64") { imports.add("math"); checks.push("!math.IsNaN(decoded)", "!math.IsInf(decoded, 0)"); }
      if (schema.type === "integer") checks.push("math.Trunc(decoded) == decoded");
      for (const [keyword, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
        if (schema[keyword] !== undefined) checks.push(`${keyword.endsWith("Length") ? "utf8.RuneCountInString(decoded)" : "decoded"} ${operator} ${schema[keyword]}`);
      }
      body = `decoded, ok := value.(${type})
if !(${checks.join(" && ")}) { var zero ${name}; return zero, errWireValue }`;
      if (schema.enum !== undefined || "const" in schema) {
        const values = ("const" in schema ? [schema.const] : schema.enum) as unknown[];
        if (values.some(value => typeof value !== (type === "float64" ? "number" : type === "bool" ? "boolean" : "string"))) throw new TypeError("CAMB Go literal does not match its scalar type");
        body += `\nswitch decoded { case ${values.map(value => JSON.stringify(value)).join(", ")}: return decoded, nil; default: var zero ${name}; return zero, errWireValue }`;
      } else body += "\nreturn decoded, nil";
      encode = `decoded, err := decode${name}(value); if err != nil { return nil, err }; return decoded, nil`;
    }
    functions.push(`func decode${name}(value any) (${name}, error) {\n${body}\n}`);
    functions.push(`func encode${name}(value ${name}) (any, error) {\n${encode}\n}`);
    return name;
  }
  compile(contract.http, contract.input, "HttpInput");
  for (const [name, schema] of contract.messages) {
    const resolved = contract.live(schema);
    if (resolved.nullable === true || resolved.type !== "object" && !(resolved.type === "string" && resolved.format === "binary")) throw new TypeError("CAMB Go messages must be non-null objects or binary audio");
    compile(contract.live, schema, name);
  }
  const binary = (name: string) => { const schema = contract.live(contract.messages.get(name)); return schema.type === "string" && schema.format === "binary"; };
  if (contract.groups[0]!.some(binary)) throw new TypeError("CAMB Go client messages must be JSON");
  const binaryMessages = contract.groups[1]!.filter(binary);
  if (binaryMessages.length !== 1) throw new TypeError("Expected one CAMB binary audio message");
  return `// Generated by codegen/generate-clients.ts from ${contract.urls.join(" and ")}. Do not edit.
package camb

import (
${[...imports].sort().map(value => JSON.stringify(value)).join("\n")}
"github.com/speechswitch/client/sdks/go/runtime"
)

const DefaultBaseURL = ${JSON.stringify(contract.baseUrl)}
const DefaultWebSocketURL = ${JSON.stringify(contract.webSocketUrl)}
var errWireValue = errors.New("Invalid CAMB wire value")

${declarations.join("\n\n")}

${["ClientMessage", "ServerMessage"].map((group, index) => `type ${group} interface { is${group}() }\n${contract.groups[index]!.map(name => `func (${name}) is${group}() {}`).join("\n")}`).join("\n")}

${functions.join("\n\n")}

// ParseHttpInput validates the selected request without inserting vendor defaults.
func ParseHttpInput(value any) (HttpInput, error) {
result, err := decodeHttpInput(value)
if err != nil { return HttpInput{}, errors.New("Invalid CAMB HTTP synthesis request") }
return result, nil
}

func EncodeMessage(message ClientMessage) (runtime.WebSocketText, error) {
data, err := json.Marshal(message)
if err != nil { return "", errors.New("Invalid CAMB WebSocket input") }
var value any
if err := json.Unmarshal(data, &value); err != nil { return "", err }
${contract.groups[0]!.map(name => `if _, err := decode${name}(value); err == nil { return runtime.WebSocketText(data), nil }`).join("\n")}
return "", errors.New("Invalid CAMB WebSocket input")
}

func DecodeMessage(message runtime.WebSocketMessage) (ServerMessage, error) {
var data []byte
switch message := message.(type) {
case runtime.WebSocketBinary: return ${binaryMessages[0]}(message), nil
case *runtime.WebSocketBinary: if message != nil { return ${binaryMessages[0]}(*message), nil }
case runtime.WebSocketText: data = []byte(message)
case *runtime.WebSocketText: if message != nil { data = []byte(*message) }
}
if !runtime.ValidUTF8JSON(data) { return nil, errors.New("Invalid CAMB WebSocket message") }
var value any
if err := json.Unmarshal(data, &value); err != nil { return nil, errors.New("Invalid CAMB WebSocket message") }
${contract.groups[1]!.filter(name => !binary(name)).map(name => `if decoded, err := decode${name}(value); err == nil { return decoded, nil }`).join("\n")}
return nil, errors.New("Invalid CAMB WebSocket message")
}

func StreamSpeech(ctx context.Context, value HttpInput, apiKey, baseURL string, transport runtime.HTTPTransport) (*runtime.HTTPResponse, error) {
data, err := json.Marshal(value)
if err != nil { return nil, errors.New("Invalid CAMB HTTP synthesis request") }
var raw any
if err := json.Unmarshal(data, &raw); err != nil { return nil, err }
if _, err := ParseHttpInput(raw); err != nil { return nil, err }
target, err := url.Parse(baseURL)
if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || target.Opaque != "" || (target.Scheme != "http" && target.Scheme != "https") { return nil, errors.New("CAMB BaseURL must be an HTTP(S) URL without credentials or a fragment") }
escaped := strings.TrimRight(target.EscapedPath(), "/") + ${JSON.stringify(contract.path)}
target.Path = strings.TrimRight(target.Path, "/") + ${JSON.stringify(contract.path)}
target.RawPath = escaped
request, err := http.NewRequestWithContext(ctx, ${JSON.stringify(contract.method.toUpperCase())}, target.String(), bytes.NewReader(data))
if err != nil { return nil, errors.New("Invalid CAMB request URL") }
request.Header.Set(${JSON.stringify(contract.header)}, apiKey)
request.Header.Set("content-type", "application/json")
return runtime.OpenResponse(request, transport)
}
`;
}
