import { pascal } from "./language-types.ts";
import { parseGoogleDiscovery, type GoogleDiscoverySchema } from "./google-discovery.ts";

/** Compile Discovery schemas into concrete Go types, serializers and HTTP calls. */
export function renderGoogleDiscoveryGo(raw: unknown, sourceUrl: string, packageName: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(packageName) || ["package", "type", "func", "map", "var", "const", "import", "range", "go", "interface", "struct"].includes(packageName)) throw new TypeError(`Invalid Go Discovery package: ${packageName}`);
  const { document, methods } = parseGoogleDiscovery(raw);
  const nodes = new Map<string, GoogleDiscoverySchema>();
  const names = new Map<GoogleDiscoverySchema, string>();
  const active = new Set<GoogleDiscoverySchema>();
  const identifiers = new Set(["ClientOptions", "DefaultBaseURL", ...methods.flatMap(method => [pascal(method.name), "Decode" + pascal(method.name) + "Response"])]);
  const imports = new Set(["bytes", "context", "encoding/json", "errors", "fmt", "net/http", "net/url", "strings", "unicode/utf8"]);
  function add(schema: GoogleDiscoverySchema, suggested: string): string {
    if (schema.$ref) {
      const target = document.schemas[schema.$ref];
      if (!target) throw new TypeError(`Unresolved Google Discovery reference: ${schema.$ref}`);
      return add(target, schema.$ref);
    }
    if (active.has(schema)) throw new TypeError(`Recursive Go Discovery schema: ${suggested}`);
    const previous = names.get(schema); if (previous) return previous;
    if (!/^[A-Z][A-Za-z0-9]*$/.test(suggested) || identifiers.has(suggested)) throw new TypeError(`Colliding or invalid Go Discovery type: ${suggested}`);
    identifiers.add(suggested); nodes.set(suggested, schema); names.set(schema, suggested); active.add(schema);
    if (schema.enum) {
      if (schema.type !== "string" || !schema.enum.length || !schema.enum.every(value => typeof value === "string")) throw new TypeError("Invalid Google Discovery enum");
      for (const value of schema.enum) {
        const variant = suggested + pascal(value);
        if (identifiers.has(variant)) throw new TypeError(`Colliding Go Discovery enum: ${variant}`);
        identifiers.add(variant);
      }
    } else switch (schema.type) {
      case "string": case "boolean": break;
      case "number": imports.add("math"); break;
      case "integer":
        if (schema.format === "int32" || schema.format === "int64") imports.add("strconv");
        else if (schema.format === undefined) imports.add("math/big");
        else throw new TypeError(`Unsupported Go Discovery integer format: ${schema.format}`);
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
            const id = pascal(key);
            if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || fields.has(id)) throw new TypeError(`Colliding or invalid Go Discovery field: ${suggested}.${key}`);
            fields.add(id); add(field, suggested + id);
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
  const name = (schema: GoogleDiscoverySchema): string => schema.$ref ?? names.get(schema)!;
  const out: string[] = [];
  for (const [id, schema] of nodes) {
    let encode: string; let decode: string;
    if (schema.enum) {
      out.push(`type ${id} interface { is${id}() }`);
      for (const value of schema.enum) out.push(`type ${id + pascal(value)} struct {}`, `func (${id + pascal(value)}) is${id}() {}`);
      encode = `switch value := value.(type) {\n${schema.enum.map(value => `case ${id + pascal(value)}: return ${JSON.stringify(value)}, nil\ncase *${id + pascal(value)}: if value != nil { return ${JSON.stringify(value)}, nil }`).join("\n")}\n}; return nil, errWireValue`;
      decode = `text, ok := value.(string); if !ok { return nil, errWireValue }; switch text {\n${schema.enum.map(value => `case ${JSON.stringify(value)}: return ${id + pascal(value)}{}, nil`).join("\n")}\n}; return nil, errWireValue`;
    } else if (schema.type === "object" && schema.properties) {
      const fields = Object.entries(schema.properties).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => ({ key, field: pascal(key), type: name(field), required: schema.required?.includes(key) === true }));
      out.push(`type ${id} struct {\n${fields.map(field => `${field.field} ${field.required ? field.type : `runtime.Optional[${field.type}]`}`).join("\n")}\n}`);
      encode = `object := map[string]any{}\n${fields.map(field => `${field.required ? "{" : `if value.${field.field}.Present {`}\nitem, err := encode${field.type}(value.${field.field}${field.required ? "" : ".Value"}); if err != nil { return nil, err }; object[${JSON.stringify(field.key)}] = item\n}`).join("\n")}\nreturn object, nil`;
      decode = `var result ${id}; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }\n${fields.map(field => `if item, present := object[${JSON.stringify(field.key)}]; present {\ndecoded, err := decode${field.type}(item); if err != nil { return ${id}{}, err }; result.${field.field} = ${field.required ? "decoded" : "runtime.Some(decoded)"}\n}${field.required ? ` else { return ${id}{}, errWireValue }` : ""}`).join("\n")}\nreturn result, nil`;
    } else if (schema.type === "object") {
      const child = name(schema.additionalProperties!);
      out.push(`type ${id} = map[string]${child}`);
      encode = `object := map[string]any{}; for key, item := range value { if !utf8.ValidString(key) { return nil, errWireValue }; encoded, err := encode${child}(item); if err != nil { return nil, err }; object[key] = encoded }; return object, nil`;
      decode = `object, ok := value.(map[string]any); if !ok || object == nil { return nil, errWireValue }; result := make(${id}, len(object)); for key, item := range object { decoded, err := decode${child}(item); if err != nil { return nil, err }; result[key] = decoded }; return result, nil`;
    } else if (schema.type === "array") {
      const child = name(schema.items!);
      out.push(`type ${id} = []${child}`);
      encode = `items := make([]any, len(value)); for index, item := range value { encoded, err := encode${child}(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil`;
      decode = `items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(${id}, len(items)); for index, item := range items { decoded, err := decode${child}(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil`;
    } else {
      const type = schema.type === "string" ? "string" : schema.type === "boolean" ? "bool" : schema.type === "number" ? "float64" : schema.format === "int32" ? "int32" : schema.format === "int64" ? "int64" : "*big.Int";
      out.push(`type ${id} = ${type}`);
      if (type === "string" || type === "bool") {
        encode = `${type === "string" ? "if !utf8.ValidString(value) { return nil, errWireValue }; " : ""}return value, nil`;
        decode = `decoded, ok := value.(${type}); if !ok { var zero ${id}; return zero, errWireValue }; return decoded, nil`;
      } else if (type === "float64") {
        encode = "if math.IsNaN(value) || math.IsInf(value, 0) { return nil, errWireValue }; return value, nil";
        decode = "number, ok := value.(json.Number); if !ok { return 0, errWireValue }; decoded, err := number.Float64(); if err != nil || math.IsNaN(decoded) || math.IsInf(decoded, 0) { return 0, errWireValue }; return decoded, nil";
      } else if (type === "*big.Int") {
        encode = "if value == nil { return nil, errWireValue }; return json.Number(value.String()), nil";
        decode = "number, ok := value.(json.Number); if !ok { return nil, errWireValue }; decoded, ok := new(big.Int).SetString(string(number), 10); if !ok { return nil, errWireValue }; return decoded, nil";
      } else {
        encode = "return value, nil";
        decode = `number, ok := value.(json.Number); if !ok { return 0, errWireValue }; decoded, err := strconv.ParseInt(string(number), 10, ${type === "int32" ? 32 : 64}); if err != nil { return 0, errWireValue }; return ${type}(decoded), nil`;
      }
    }
    out.push(`func encode${id}(value ${id}) (any, error) {\n${encode}\n}`, `func decode${id}(value any) (${id}, error) {\n${decode}\n}`, "");
  }
  for (const operation of operations) {
    const id = pascal(operation.name);
    const parameters = Object.keys(operation.wire.parameters ?? {}).sort();
    out.push(`func ${id}(ctx context.Context, value ${operation.input}, options ClientOptions) (*http.Response, error) {`,
      `${operation.wire.request || parameters.length ? "object" : "_"}, err := encode${operation.input}(value); if err != nil { return nil, errors.New(${JSON.stringify(`Invalid Google ${operation.name} input`)}) }`,
      `target, err := url.Parse(options.BaseURL)`,
      `if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || target.Opaque != "" || (target.Scheme != "http" && target.Scheme != "https") { return nil, errors.New("Google BaseURL must be an HTTP(S) URL without credentials or a fragment") }`,
      `query, err := url.ParseQuery(target.RawQuery); if err != nil { return nil, errors.New("Invalid Google query string") }`);
    if (!operation.wire.request && parameters.length) out.push("fields := object.(map[string]any)");
    for (const key of parameters) out.push(`if item, present := fields[${JSON.stringify(key)}]; present { query.Set(${JSON.stringify(key)}, fmt.Sprint(item)) }`);
    out.push(`target.RawPath = strings.TrimSuffix(target.EscapedPath(), "/") + ${JSON.stringify("/" + operation.wire.path)}`, `target.Path = strings.TrimSuffix(target.Path, "/") + ${JSON.stringify("/" + operation.wire.path)}`, "target.RawQuery = query.Encode()", "var body []byte");
    if (operation.wire.request) out.push("body, err = json.Marshal(object); if err != nil { return nil, err }");
    out.push(`request, err := http.NewRequestWithContext(ctx, ${JSON.stringify(operation.wire.httpMethod)}, target.String(), bytes.NewReader(body)); if err != nil { return nil, err }`,
      "request.Header = make(http.Header)", "for key, values := range options.Headers { for _, value := range values { request.Header.Add(key, value) } }");
    if (operation.wire.request) out.push('request.Header.Set("Content-Type", "application/json")');
    out.push('if options.Transport == nil { return nil, errors.New("Google HTTP transport is required") }', "return options.Transport.Do(request)", "}", "");
    out.push(`func Decode${id}Response(data []byte) (${operation.response}, error) {`,
      `var zero ${operation.response}`, `if !runtime.ValidUTF8JSON(data) { return zero, errors.New(${JSON.stringify(`Invalid Google ${operation.name} response`)}) }`,
      "decoder := json.NewDecoder(bytes.NewReader(data)); decoder.UseNumber(); var raw any", `if err := decoder.Decode(&raw); err != nil { return zero, errors.New(${JSON.stringify(`Invalid Google ${operation.name} response`)}) }`,
      `value, err := decode${operation.response}(raw); if err != nil { return zero, errors.New(${JSON.stringify(`Invalid Google ${operation.name} response`)}) }; return value, nil`, "}", "");
  }
  // Query conversion imports are needed only for an operation with parameters.
  if (operations.every(operation => !Object.keys(operation.wire.parameters ?? {}).length)) imports.delete("fmt");
  return `// Generated from ${sourceUrl}. Do not edit.\npackage ${packageName}\n\nimport (\n${[...imports].sort().map(value => JSON.stringify(value)).join("\n")}\n"github.com/speechswitch/client/sdks/go/runtime"\n)\n\nconst DefaultBaseURL = ${JSON.stringify(document.rootUrl)}\nvar errWireValue = errors.New("Invalid Google wire value")\ntype ClientOptions struct { BaseURL string; Headers http.Header; Transport runtime.HTTPTransport }\n\n${out.join("\n")}\n`;
}
