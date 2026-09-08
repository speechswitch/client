import type { LovoContract } from "./lovo-contract.ts";
import { pascal } from "./language-types.ts";

/** Concrete wire codecs and HTTP operations from the validated OpenAPI graph. */
export function renderLovoGoClient(contract: LovoContract): string {
  const declarations: string[] = [], functions: string[] = [], operations: string[] = [];
  const names = new Set(contract.operations.flatMap(op => [pascal(op.name) + "Input", pascal(op.name) + "Response"]));
  const references = new Map<string, string>();
  const imports = new Set(["bytes", "context", "encoding/json", "errors", "net/http", "net/url", "strings", "unicode/utf8"]);
  function reserve(stem: string): string {
    let name = stem;
    for (let n = 2; names.has(name); n++) name = stem + n;
    names.add(name); return name;
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
    if (schema.nullable === true) {
      const target = compile({ ...schema, nullable: false }, reserve(name + "Value"), depth + 1);
      declarations.push(`type ${name} = *${target}`);
      functions.push(`func decode${name}(value any) (${name}, error) {
if value == nil { return nil, nil }
decoded, err := decode${target}(value)
if err != nil { return nil, err }; return &decoded, nil
}
func encode${name}(value ${name}) (any, error) {
if value == nil { return nil, nil }; return encode${target}(*value)
}`);
      return name;
    }
    let decode: string, encode: string;
    if (schema.type === "object") {
      const required = (schema.required ?? []) as string[];
      const fieldNames = new Set(["Extra"]);
      const fields = Object.entries(schema.properties as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => {
        const stem = pascal(key); let field = stem;
        for (let n = 2; fieldNames.has(field); n++) field = stem + n;
        fieldNames.add(field);
        return { key, field, type: compile(child, reserve(name + stem), depth + 1), required: required.includes(key) };
      });
      const extra = schema.additionalProperties !== false;
      declarations.push(`type ${name} struct {
${fields.map(f => `${f.field} ${f.required ? f.type : `runtime.Optional[${f.type}]`}`).join("\n")}
${extra ? "Extra map[string]any" : ""}
}`);
      const known = fields.length ? `case ${fields.map(f => JSON.stringify(f.key)).join(", ")}:` : "";
      decode = `var result ${name}
object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
${fields.map(f => `if raw, present := object[${JSON.stringify(f.key)}]; present {
decoded, err := decode${f.type}(raw); if err != nil { return result, err }
result.${f.field} = ${f.required ? "decoded" : "runtime.Some(decoded)"}
}${f.required ? " else { return result, errWireValue }" : ""}`).join("\n")}
for key, item := range object {
switch key { ${known ? known + " continue" : ""} }
${extra ? "if result.Extra == nil { result.Extra = map[string]any{} }; result.Extra[key] = item" : "_ = item; return result, errWireValue"}
}
return result, nil`;
      encode = `object := map[string]any{}
${extra ? `for key, item := range value.Extra { switch key { ${known ? known + " return nil, errWireValue" : ""} }; object[key] = item }` : ""}
${fields.map(f => `${f.required ? "{" : `if value.${f.field}.Present {`}
item, err := encode${f.type}(value.${f.field}${f.required ? "" : ".Value"}); if err != nil { return nil, err }
object[${JSON.stringify(f.key)}] = item
}`).join("\n")}
return object, nil`;
    } else if (schema.type === "array") {
      const item = compile(schema.items, reserve(name + "Item"), depth + 1);
      declarations.push(`type ${name} []${item}`);
      decode = `items, ok := value.([]any); if !ok { return nil, errWireValue }
result := make(${name}, len(items))
for index, item := range items { decoded, err := decode${item}(item); if err != nil { return nil, err }; result[index] = decoded }
return result, nil`;
      encode = `items := make([]any, len(value))
for index, item := range value { encoded, err := encode${item}(item); if err != nil { return nil, err }; items[index] = encoded }
return items, nil`;
    } else {
      const type = schema.type === "string" ? "string" : schema.type === "boolean" ? "bool" : "float64";
      declarations.push(`type ${name} = ${type}`);
      const checks = ["ok"];
      if (type === "string") checks.push("utf8.ValidString(decoded)");
      if (type === "float64") { imports.add("math"); checks.push("!math.IsNaN(decoded)", "!math.IsInf(decoded, 0)"); }
      if (schema.type === "integer") checks.push("math.Trunc(decoded) == decoded", "math.Abs(decoded) <= 9007199254740991");
      for (const [key, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
        if (schema[key] !== undefined) checks.push(`${key.endsWith("Length") ? "utf8.RuneCountInString(decoded)" : "decoded"} ${operator} ${schema[key]}`);
      }
      if (schema.enum !== undefined) checks.push(`(${(schema.enum as unknown[]).map(v => `decoded == ${JSON.stringify(v)}`).join(" || ")})`);
      decode = `decoded, ok := value.(${type})
if !(${checks.join(" && ")}) { var zero ${name}; return zero, errWireValue }; return decoded, nil`;
      encode = `return decode${name}(value)`;
    }
    functions.push(`func decode${name}(value any) (${name}, error) {\n${decode}\n}\nfunc encode${name}(value ${name}) (any, error) {\n${encode}\n}`);
    return name;
  }
  for (const op of contract.operations) {
    const name = pascal(op.name);
    const input = compile(op.input, name + "Input"), output = compile(op.output, name + "Response");
    if (input !== name + "Input") declarations.push(`type ${name}Input = ${input}`);
    if (output !== name + "Response") declarations.push(`type ${name}Response = ${output}`);
    let route = JSON.stringify(op.path);
    for (const p of op.parameters) route = `strings.ReplaceAll(${route}, ${JSON.stringify("{" + p + "}")}, url.PathEscape(value.${pascal(p)}))`;
    operations.push(`const ${name}Status = ${op.status}

func Decode${name}(data []byte) (${name}Response, error) {
var zero ${name}Response; var value any
if !runtime.ValidUTF8JSON(data) { return zero, errors.New(${JSON.stringify("Invalid LOVO " + op.id + " response")}) }
if err := json.Unmarshal(data, &value); err != nil { return zero, errors.New(${JSON.stringify("Invalid LOVO " + op.id + " response")}) }
result, err := decode${output}(value)
if err != nil { return zero, errors.New(${JSON.stringify("Invalid LOVO " + op.id + " response")}) }; return result, nil
}

func ${name}(ctx context.Context, value ${name}Input, apiKey, baseURL string, transport runtime.HTTPTransport) (*runtime.HTTPResponse, error) {
raw, err := encode${input}(value)
if err != nil { return nil, errors.New(${JSON.stringify("Invalid LOVO " + op.id + " request")}) }
data, err := json.Marshal(raw)
if err != nil { return nil, errors.New(${JSON.stringify("Invalid LOVO " + op.id + " request")}) }
target, err := url.Parse(baseURL)
if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || target.Opaque != "" || (target.Scheme != "http" && target.Scheme != "https") { return nil, errors.New("Invalid LOVO BaseURL") }
escaped := strings.TrimRight(target.EscapedPath(), "/") + ${route}
target.Path, err = url.PathUnescape(escaped); if err != nil { return nil, errors.New("Invalid LOVO request URL") }; target.RawPath = escaped
request, err := http.NewRequestWithContext(ctx, ${JSON.stringify(op.method.toUpperCase())}, target.String(), bytes.NewReader(${op.body ? "data" : "nil"}))
${op.body ? "" : "_ = data"}
if err != nil { return nil, errors.New("Invalid LOVO request URL") }
request.Header.Set(${JSON.stringify(op.header)}, apiKey)
${op.body ? 'request.Header.Set("content-type", "application/json")' : ""}
return runtime.OpenResponse(request, transport)
}`);
  }
  return `// Generated by codegen/generate-clients.ts from ${contract.sourceUrl}. Do not edit.
package lovo

import (
${[...imports].sort().map(v => JSON.stringify(v)).join("\n")}
"github.com/speechswitch/client/sdks/go/runtime"
)

const DefaultBaseURL = ${JSON.stringify(contract.baseUrl)}
var errWireValue = errors.New("Invalid LOVO wire value")

${declarations.join("\n\n")}

${functions.join("\n\n")}

${operations.join("\n\n")}
`;
}
