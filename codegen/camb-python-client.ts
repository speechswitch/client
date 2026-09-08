import type { CambContract } from "./camb-contract.ts";

type Schema = Record<string, unknown>;
type Resolver = (value: unknown) => Schema;

function literal(value: unknown): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  return JSON.stringify(value);
}

/** The selected graph is validated by camb-client before language rendering. */
export function renderCambPythonClient(options: CambContract): string {
  const declarations: string[] = [];
  const names = new Set<string>(["HttpInput", "ClientMessage", "ServerMessage", ...options.messages.keys()]);
  function nestedName(parent: string, property: string): string {
    const stem = `${parent}_${property.replace(/[^A-Za-z0-9_]/g, "_")}`;
    let name = stem;
    for (let suffix = 2; names.has(name); suffix++) name = `${stem}_${suffix}`;
    names.add(name);
    return name;
  }
  function compile(resolve: Resolver, value: unknown, name: string, expression: string, depth = 0): { type: string; check: string } {
    if (depth > 50) throw new TypeError("CAMB schema graph is too deep or recursive");
    const schema = resolve(value);
    let type: string;
    let check: string;
    if (Array.isArray(schema.anyOf)) {
      const parts = schema.anyOf.map((child, index) => compile(resolve, child, nestedName(name, `Variant${index}`), expression, depth + 1));
      type = parts.map(part => part.type).join(" | ");
      check = `(${parts.map(part => part.check).join(" or ")})`;
    } else if (schema.type === "object") {
      const properties = (schema.properties ?? {}) as Schema;
      const required = schema.required as string[] | undefined;
      const fields: string[] = [];
      const checks = [`is_mapping(${expression})`];
      for (const [key, child] of Object.entries(properties)) {
        const property = literal(key);
        const part = compile(resolve, child, nestedName(name, key), `${expression}[${property}]`, depth + 1);
        const mandatory = required?.includes(key);
        fields.push(`${property}: ${mandatory ? part.type : `NotRequired[${part.type}]`}`);
        checks.push(mandatory ? `(${property} in ${expression} and ${part.check})` : `(${property} not in ${expression} or ${part.check})`);
      }
      if (schema.additionalProperties === false) checks.push(`all(key in ${literal(Object.keys(properties))} for key in ${expression})`);
      declarations.push(`${name} = TypedDict(${literal(name)}, {\n${fields.map(field => `    ${field},`).join("\n")}\n})`);
      type = name;
      check = `(${checks.join(" and ")})`;
    } else if (schema.type === "array") {
      const item = `item${depth}`;
      const part = compile(resolve, schema.items, nestedName(name, "Item"), item, depth + 1);
      type = `Sequence[${part.type}]`;
      check = `(is_sequence(${expression}) and all(${part.check} for index${depth} in range(len(${expression})) for ${item} in (${expression}[index${depth}],)))`;
    } else if (schema.type === "string" && schema.format === "binary") {
      type = "bytes"; check = `isinstance(${expression}, bytes)`;
    } else if (schema.type === "null") {
      type = "None"; check = `${expression} is None`;
    } else {
      // JSON Schema integers include 1.0; the predicate enforces integrality
      // without claiming that decoded values have Python's runtime int class.
      type = schema.type === "string" ? "str" : schema.type === "boolean" ? "bool" : "float";
      const checks = [type === "float" ? `is_number(${expression})` : `isinstance(${expression}, ${type})`];
      if (schema.type === "integer") checks.push(`(isinstance(${expression}, int) or ${expression}.is_integer())`);
      for (const [keyword, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
        if (schema[keyword] !== undefined) checks.push(`${keyword.endsWith("Length") ? `code_point_length(${expression})` : expression} ${operator} ${literal(schema[keyword])}`);
      }
      check = `(${checks.join(" and ")})`;
    }
    if (schema.enum !== undefined || "const" in schema) {
      const values = ("const" in schema ? [schema.const] : schema.enum) as (string | number | boolean | null)[];
      if (values.some(value => typeof value === "number" && !Number.isSafeInteger(value))) throw new TypeError("CAMB Python literals require safe integers");
      type = `Literal[${values.map(literal).join(", ")}]`;
      const scalars = values.filter(value => typeof value === "string" || typeof value === "number");
      const comparisons = values.filter(value => value === null || typeof value === "boolean").map(value => `${expression} is ${literal(value)}`);
      if (scalars.length) comparisons.push(`(${schema.type === "string" ? "" : `not isinstance(${expression}, bool) and `}${expression} in (${scalars.map(literal).join(", ")},))`);
      check = `(${check} and (${comparisons.join(" or ")}))`;
    }
    if (schema.nullable === true) {
      type = `${type} | None`; check = `(${expression} is None or ${check})`;
    }
    return { type, check };
  }
  function root(resolve: Resolver, value: unknown, name: string) {
    const part = compile(resolve, value, nestedName(name, "Value"), "value");
    declarations.push(`${name}: TypeAlias = ${part.type}`);
    return part;
  }
  const input = root(options.http, options.input, "HttpInput");
  const checks = new Map<string, string>();
  for (const [name, value] of options.messages) checks.set(name, root(options.live, value, name).check);
  return `# Generated by codegen/generate-clients.ts from ${options.urls.join(" and ")}. Do not edit.
import json
from collections.abc import Sequence
from typing import Literal, NoReturn, NotRequired, TypeAlias, TypedDict, TypeGuard
from urllib.parse import urlsplit, urlunsplit

from speechswitch.http import HttpRequest, HttpResponse, HttpTransport
from speechswitch.validation import code_point_length, is_mapping, is_number, is_sequence

DEFAULT_BASE_URL = ${literal(options.baseUrl)}
DEFAULT_WEB_SOCKET_URL = ${literal(options.webSocketUrl)}

${declarations.join("\n\n")}

ClientMessage: TypeAlias = ${options.groups[0]!.join(" | ")}
ServerMessage: TypeAlias = ${options.groups[1]!.join(" | ")}

def is_http_input(value: object) -> TypeGuard[HttpInput]:
    return ${input.check}

def is_client_message(value: object) -> TypeGuard[ClientMessage]:
    return ${options.groups[0]!.map(name => checks.get(name)!).join(" or ")}

def is_server_message(value: object) -> TypeGuard[ServerMessage]:
    return ${options.groups[1]!.map(name => checks.get(name)!).join(" or ")}

def encode_message(message: ClientMessage) -> str:
    if not is_client_message(message):
        raise TypeError("Invalid CAMB WebSocket input")
    return json.dumps(message, separators=(",", ":"), allow_nan=False)

def _invalid_constant(value: str) -> NoReturn:
    raise TypeError("Invalid CAMB WebSocket JSON")

def decode_message(data: str | bytes) -> ServerMessage:
    value: object = json.loads(data, parse_constant=_invalid_constant) if isinstance(data, str) else data
    if not is_server_message(value):
        raise TypeError("Invalid CAMB WebSocket message")
    return value

async def stream_speech(value: HttpInput, *, api_key: str, base_url: str, transport: HttpTransport) -> HttpResponse:
    if not is_http_input(value):
        raise TypeError("Invalid CAMB HTTP synthesis request")
    url = urlsplit(base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment:
        raise TypeError("CAMB base_url must be an HTTP(S) URL without credentials or a fragment")
    target = urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + ${literal(options.path)}, url.query, ""))
    return await transport.send(HttpRequest(${literal(options.method.toUpperCase())}, target,
        {${literal(options.header)}: api_key, "content-type": "application/json"},
        json.dumps(value, separators=(",", ":"), allow_nan=False).encode("utf-8")))
`;
}
