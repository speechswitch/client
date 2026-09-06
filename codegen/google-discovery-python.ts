import { parseGoogleDiscovery, type GoogleDiscoverySchema } from "./google-discovery.ts";

const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** Resolve Discovery into wire types, direct validators and injected HTTP calls. */
export function renderGoogleDiscoveryPython(raw: unknown, sourceUrl: string): string {
  const { document, methods } = parseGoogleDiscovery(raw);
  const types = new Map<string, GoogleDiscoverySchema>();
  const names = new Map<GoogleDiscoverySchema, string>();
  const functions = new Set<string>();
  function add(name: string, schema: GoogleDiscoverySchema) {
    if (types.get(name) === schema) return;
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name) || types.has(name) || functions.has(snake(name))) throw new TypeError(`Colliding or invalid Python Discovery type: ${name}`);
    types.set(name, schema); names.set(schema, name); functions.add(snake(name));
    visit(schema, name);
  }
  function visit(schema: GoogleDiscoverySchema, name: string): void {
    if (schema.$ref) {
      const target = document.schemas[schema.$ref];
      if (!target) throw new TypeError(`Unresolved Google Discovery reference: ${schema.$ref}`);
      add(schema.$ref, target); return;
    }
    if (schema.enum) {
      if (schema.type !== "string" || !schema.enum.length || !schema.enum.every(item => typeof item === "string")) throw new TypeError("Invalid Google Discovery enum");
      return;
    }
    switch (schema.type) {
      case "string": case "boolean": case "integer": case "number": return;
      case "array":
        if (!schema.items) throw new TypeError("Google Discovery array lacks item schema");
        nested(schema.items, name + "Item"); return;
      case "object":
        if (schema.additionalProperties) {
          if (schema.properties) throw new TypeError("Google Discovery mixed map/object schemas need explicit support");
          nested(schema.additionalProperties, name + "Value"); return;
        }
        if (!schema.properties) throw new TypeError("Google Discovery object lacks properties");
        if (schema.required?.some(key => !Object.hasOwn(schema.properties!, key))) throw new TypeError(`Unknown required Google Discovery field: ${name}`);
        for (const [key, field] of Object.entries(schema.properties).sort(([a], [b]) => a.localeCompare(b))) {
          if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) throw new TypeError(`Unsupported Python Discovery field: ${name}.${key}`);
          nested(field, name + key[0]!.toUpperCase() + key.slice(1));
        }
        return;
      default: throw new TypeError(`Unsupported Google Discovery type: ${schema.type}`);
    }
  }
  function nested(schema: GoogleDiscoverySchema, name: string) {
    if (schema.type === "object" && !schema.additionalProperties && !schema.$ref) add(name, schema);
    else visit(schema, name);
  }
  const operations = methods.map(method => {
    const input: GoogleDiscoverySchema = method.wire.request ?? {
      type: "object", properties: Object.fromEntries(Object.entries(method.wire.parameters ?? {}).map(([name, parameter]) => [name, { type: parameter.type, enum: parameter.enum }])),
      required: Object.entries(method.wire.parameters ?? {}).filter(([, field]) => field.required).map(([name]) => name),
    };
    const inputName = input.$ref ?? method.name[0]!.toUpperCase() + method.name.slice(1) + "Input";
    if (input.$ref) visit(input, inputName); else add(inputName, input);
    const responseName = method.wire.response.$ref;
    if (!responseName) throw new TypeError("Google Discovery method response must reference a named schema");
    visit(method.wire.response, responseName);
    return { ...method, inputName, responseName };
  });
  const out = [
    `# Generated from ${sourceUrl}. Do not edit.`,
    "import json", "from collections.abc import Mapping, Sequence", "from typing import Literal, Never, NotRequired, ReadOnly, TypeGuard, TypedDict",
    "from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit", "",
    "from speechswitch.http import HttpRequest, HttpResponse, HttpTransport",
    "from speechswitch.validation import is_mapping, is_number, is_sequence", "",
    `DEFAULT_BASE_URL = ${JSON.stringify(document.rootUrl)}`, "",
    "def _invalid_json_constant(value: str) -> Never:", '    raise TypeError("Invalid Google JSON constant")', "",
  ];
  function type(schema: GoogleDiscoverySchema, root = false): string {
    const name = schema.$ref ?? (!root ? names.get(schema) : undefined);
    if (name) return JSON.stringify(name);
    if (schema.enum) return `Literal[${schema.enum.map(value => JSON.stringify(value)).join(", ")}]`;
    switch (schema.type) {
      case "string": return "str";
      case "boolean": return "bool";
      case "integer": return "int";
      case "number": return "float";
      case "array": return `Sequence[${type(schema.items!)}]`;
      case "object": return `Mapping[str, ${type(schema.additionalProperties!)}]`;
      default: throw new TypeError(`Unsupported Google Discovery type: ${schema.type}`);
    }
  }
  function check(schema: GoogleDiscoverySchema, value: string, depth = 0, root = false): string {
    const name = schema.$ref ?? (!root ? names.get(schema) : undefined);
    if (name) return `is_${snake(name)}(${value})`;
    if (schema.enum) return `(isinstance(${value}, str) and ${value} in (${schema.enum.map(item => JSON.stringify(item)).join(", ")},))`;
    switch (schema.type) {
      case "string": return `isinstance(${value}, str)`;
      case "boolean": return `isinstance(${value}, bool)`;
      case "integer": return `(isinstance(${value}, int) and not isinstance(${value}, bool))`;
      case "number": return `is_number(${value})`;
      case "array": return `(is_sequence(${value}) and all(${check(schema.items!, `item${depth}`, depth + 1)} for item${depth} in ${value}))`;
      case "object": {
        if (schema.additionalProperties) return `(is_mapping(${value}) and all(isinstance(key${depth}, str) and ${check(schema.additionalProperties, `item${depth}`, depth + 1)} for key${depth}, item${depth} in ${value}.items()))`;
        return `(is_mapping(${value})${Object.entries(schema.properties!).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => ` and (${JSON.stringify(key)} ${schema.required?.includes(key) ? "in" : "not in"} ${value} ${schema.required?.includes(key) ? "and" : "or"} ${check(field, `${value}[${JSON.stringify(key)}]`, depth + 1)})`).join("")})`;
      }
      default: throw new TypeError(`Unsupported Google Discovery type: ${schema.type}`);
    }
  }
  function encode(schema: GoogleDiscoverySchema, value: string, depth = 0, root = false): string {
    const name = schema.$ref ?? (!root ? names.get(schema) : undefined);
    if (name) return `_encode_${snake(name)}(${value})`;
    if (schema.type === "array") return `[${encode(schema.items!, `item${depth}`, depth + 1)} for item${depth} in ${value}]`;
    if (schema.additionalProperties) return `{key${depth}: ${encode(schema.additionalProperties, `item${depth}`, depth + 1)} for key${depth}, item${depth} in ${value}.items()}`;
    return value;
  }
  const encoders = new Set<string>();
  function requireEncoder(name: string) {
    if (encoders.has(name)) return;
    encoders.add(name);
    visitEncoding(types.get(name)!, true);
  }
  function visitEncoding(schema: GoogleDiscoverySchema, root = false) {
    const name = schema.$ref ?? (!root ? names.get(schema) : undefined);
    if (name) { requireEncoder(name); return; }
    if (schema.items) visitEncoding(schema.items);
    if (schema.additionalProperties) visitEncoding(schema.additionalProperties);
    for (const field of Object.values(schema.properties ?? {})) visitEncoding(field);
  }
  for (const operation of operations) if (operation.wire.request) requireEncoder(operation.inputName);
  for (const [name, schema] of types) {
    if (schema.type === "object" && schema.properties) {
      out.push(`${name} = TypedDict(${JSON.stringify(name)}, {`);
      for (const [key, field] of Object.entries(schema.properties).sort(([a], [b]) => a.localeCompare(b))) {
        const fieldType = `ReadOnly[${type(field)}]`;
        out.push(`    ${JSON.stringify(key)}: ${schema.required?.includes(key) ? fieldType : `NotRequired[${fieldType}]`},`);
      }
      out.push("})", "");
    } else {
      out.push(`type ${name} = ${type(schema, true)}`, "");
    }
    out.push(`def is_${snake(name)}(value: object) -> TypeGuard[${name}]:`, `    return ${check(schema, "value", 0, true)}`, "");
    if (!encoders.has(name)) continue;
    out.push(`def _encode_${snake(name)}(value: ${name}) -> object:`);
    if (schema.type === "object" && schema.properties) {
      out.push("    result: dict[str, object] = {}");
      for (const [key, field] of Object.entries(schema.properties).sort(([a], [b]) => a.localeCompare(b))) out.push(`    if ${JSON.stringify(key)} in value:`, `        result[${JSON.stringify(key)}] = ${encode(field, `value[${JSON.stringify(key)}]`)}`);
      out.push("    return result", "");
    } else {
      out.push(`    return ${encode(schema, "value", 0, true)}`, "");
    }
  }
  for (const operation of operations) {
    const name = snake(operation.name);
    out.push(`async def ${name}(value: ${operation.inputName}, *, base_url: str, headers: Mapping[str, str], transport: HttpTransport) -> HttpResponse:`,
      `    if not is_${snake(operation.inputName)}(value):`, `        raise TypeError(${JSON.stringify(`Invalid Google ${operation.name} input`)})`,
      "    url = urlsplit(base_url)",
      '    if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment:',
      '        raise TypeError("Google base_url must be an HTTP(S) URL without credentials or a fragment")',
      "    query = parse_qsl(url.query, keep_blank_values=True)");
    for (const [key, field] of Object.entries(operation.wire.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`    if ${JSON.stringify(key)} in value:`, `        query = [(key, item) for key, item in query if key != ${JSON.stringify(key)}]`,
        `        query.append((${JSON.stringify(key)}, ${field.type === "boolean" ? `"true" if value[${JSON.stringify(key)}] else "false"` : `str(value[${JSON.stringify(key)}])`}))`);
    }
    out.push(`    target = urlunsplit((url.scheme, url.netloc, url.path.removesuffix("/") + ${JSON.stringify("/" + operation.wire.path)}, urlencode(query), ""))`);
    if (operation.wire.request) out.push('    request_headers = {key: item for key, item in headers.items() if key.lower() != "content-type"}',
      '    request_headers["content-type"] = "application/json"',
      `    body = json.dumps(_encode_${snake(operation.inputName)}(value), separators=(",", ":"), allow_nan=False).encode("utf-8")`);
    out.push(`    return await transport.send(HttpRequest(${JSON.stringify(operation.wire.httpMethod)}, target, ${operation.wire.request ? 'request_headers, body' : 'dict(headers), b""'}))`, "");
    out.push(`def decode_${name}_response(data: bytes) -> ${operation.responseName}:`, "    value: object = json.loads(data, parse_constant=_invalid_json_constant)",
      `    if not is_${snake(operation.responseName)}(value):`, `        raise TypeError(${JSON.stringify(`Invalid Google ${operation.name} response`)})`, "    return value", "");
  }
  return out.join("\n");
}
