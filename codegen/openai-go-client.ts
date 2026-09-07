import type { OpenaiContract } from "./openai-contract.ts";
import { pascal } from "./language-types.ts";

/** Emit concrete codecs and a direct HTTP call from the audited speech graph. */
export function renderOpenaiGoClient(contract: OpenaiContract): string {
  const declarations: string[] = [], functions: string[] = [];
  const names = new Set(["SpeechRequest", "SpeechEvent"]), references = new Map<string, string>();
  const imports = new Set(["bytes", "context", "encoding/json", "errors", "net/http", "net/url", "strings", "unicode/utf8"]);
  function reserve(stem: string): string {
    let name = stem;
    for (let n = 2; names.has(name); n++) name = stem + n;
    names.add(name); return name;
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
      declarations.push(`type ${name} interface { is${name}() }\n` + parts.map(p => `type ${name}AsVariant${p.index} struct { Value ${p.type} }\nfunc (${name}AsVariant${p.index}) is${name}() {}`).join("\n"));
      decode = parts.map(p => `if item, err := decode${p.type}(value); err == nil { return ${name}AsVariant${p.index}{Value: item}, nil }`).join("\n") + "\nreturn nil, errWireValue";
      encode = `switch value := value.(type) {\n${parts.map(p => `case ${name}AsVariant${p.index}: return encode${p.type}(value.Value)\ncase *${name}AsVariant${p.index}: if value != nil { return encode${p.type}(value.Value) }`).join("\n")}\n}; return nil, errWireValue`;
    } else if (schema.type === "object") {
      const required = (schema.required ?? []) as string[], fieldNames = new Set(["Extra"]);
      const fields = Object.entries(schema.properties as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => {
        const stem = pascal(key); let field = stem;
        for (let n = 2; fieldNames.has(field); n++) field = stem + n;
        fieldNames.add(field);
        return { key, field, type: compile(child, reserve(name + stem), depth + 1), required: required.includes(key) };
      });
      const extra = schema.additionalProperties !== false;
      declarations.push(`type ${name} struct {\n${fields.map(f => `${f.field} ${f.required ? f.type : `runtime.Optional[${f.type}]`}`).join("\n")}\n${extra ? "Extra map[string]any" : ""}\n}`);
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
      if (Array.isArray(schema.enum)) checks.push(`(${schema.enum.map(v => `decoded == ${JSON.stringify(v)}`).join(" || ")})`);
      decode = `decoded, ok := value.(${type})\nif !(${checks.join(" && ")}) { var zero ${name}; return zero, errWireValue }; return decoded, nil`;
      encode = `return decode${name}(value)`;
    }
    functions.push(`func decode${name}(value any) (${name}, error) {\n${decode}\n}\nfunc encode${name}(value ${name}) (any, error) {\n${encode}\n}`);
    return name;
  }
  const input = compile(contract.input, "SpeechRequest"), event = compile(contract.event, "SpeechEvent");
  if (input !== "SpeechRequest") declarations.push(`type SpeechRequest = ${input}`);
  if (event !== "SpeechEvent") declarations.push(`type SpeechEvent = ${event}`);
  return `// Generated by codegen/generate-clients.ts from ${contract.sourceUrl}. Do not edit.
package openai

import (
${[...imports].sort().map(value => JSON.stringify(value)).join("\n")}
"github.com/speechswitch/client/sdks/go/runtime"
)

const DefaultBaseURL = ${JSON.stringify(contract.baseUrl)}
const SpeechStatus = ${contract.status}
var errWireValue = errors.New("Invalid OpenAI wire value")

${declarations.join("\n\n")}

${functions.join("\n\n")}

func DecodeSpeechEvent(data []byte) (SpeechEvent, error) {
var value any
if !runtime.ValidUTF8JSON(data) { return nil, errors.New("Invalid OpenAI speech event") }
if err := json.Unmarshal(data, &value); err != nil { return nil, errors.New("Invalid OpenAI speech event") }
result, err := decode${event}(value)
if err != nil { return nil, errors.New("Invalid OpenAI speech event") }; return result, nil
}

func CreateSpeech(ctx context.Context, value SpeechRequest, apiKey, baseURL string, transport runtime.HTTPTransport) (*runtime.HTTPResponse, error) {
raw, err := encode${input}(value)
if err != nil { return nil, errors.New("Invalid OpenAI speech wire request") }
data, err := json.Marshal(raw)
if err != nil { return nil, errors.New("Invalid OpenAI speech wire request") }
target, err := url.Parse(baseURL)
if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || target.Opaque != "" || (target.Scheme != "http" && target.Scheme != "https") { return nil, errors.New("Invalid OpenAI BaseURL") }
escaped := strings.TrimRight(target.EscapedPath(), "/") + ${JSON.stringify(contract.path)}
target.Path, err = url.PathUnescape(escaped); if err != nil { return nil, errors.New("Invalid OpenAI request URL") }; target.RawPath = escaped
request, err := http.NewRequestWithContext(ctx, ${JSON.stringify(contract.method.toUpperCase())}, target.String(), bytes.NewReader(data))
if err != nil { return nil, errors.New("Invalid OpenAI request URL") }
request.Header.Set("Authorization", "Bearer " + apiKey)
request.Header.Set("Content-Type", "application/json")
request.Header.Set("Accept", "application/octet-stream, text/event-stream")
return runtime.OpenResponse(request, transport)
}
`;
}
