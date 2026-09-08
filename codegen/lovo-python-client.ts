import type { LovoContract } from "./lovo-contract.ts";

function literal(value: unknown): string {
  return value === null ? "None" : value === true ? "True" : value === false ? "False" : JSON.stringify(value);
}

/** Emit concrete wire types, guards and HTTP calls from the validated TTS graph. */
export function renderLovoPythonClient(contract: LovoContract): string {
  const declarations: string[] = [];
  const functions: string[] = [];
  const names = new Set<string>();
  const nameFor = (stem: string) => {
    let name = stem.replace(/[^A-Za-z0-9_]/g, "_");
    const base = name;
    for (let n = 2; names.has(name); n++) name = `${base}_${n}`;
    names.add(name); return name;
  };
  const compile = (raw: unknown, name: string, value: string, depth = 0): { type: string; check: string; encode: string } => {
    if (depth > 50) throw new TypeError("LOVO schema graph is too deep");
    let schema = raw as Record<string, unknown>;
    if (typeof schema.$ref === "string") return compile(contract.schemas[schema.$ref.split("/").at(-1)!], name, value, depth + 1);
    let type: string; let encode = value; const checks: string[] = [];
    if (schema.type === "object") {
      const fields: string[] = [];
      const encodings: string[] = [];
      const properties = schema.properties as Record<string, unknown>;
      const required = (schema.required ?? []) as string[];
      checks.push(`is_mapping(${value})`);
      for (const [key, child] of Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))) {
        const property = literal(key);
        const part = compile(child, nameFor(`${name}_${key}`), `${value}[${property}]`, depth + 1);
        fields.push(`${property}: ${required.includes(key) ? part.type : `NotRequired[${part.type}]`}`);
        encodings.push(`**({${property}: ${part.encode}} if ${property} in ${value} else {})`);
        checks.push(required.includes(key) ? `(${property} in ${value} and ${part.check})` : `(${property} not in ${value} or ${part.check})`);
      }
      if (schema.additionalProperties === false) checks.push(`all(key in ${literal(Object.keys(properties))} for key in ${value})`);
      declarations.push(`${name} = TypedDict(${literal(name)}, {\n${fields.map(f => `    ${f},`).join("\n")}\n})`);
      type = name;
      encode = `{**${value}${encodings.length ? ", " + encodings.join(", ") : ""}}`;
    } else if (schema.type === "array") {
      const index = `index${depth}`;
      const item = `item${depth}`;
      const part = compile(schema.items, nameFor(`${name}_Item`), item, depth + 1);
      type = `Sequence[${part.type}]`;
      checks.push(`is_sequence(${value})`, `all(${part.check} for ${index} in range(len(${value})) for ${item} in (${value}[${index}],))`);
      encode = `[${part.encode} for ${index} in range(len(${value})) for ${item} in (${value}[${index}],)]`;
    } else {
      type = schema.type === "string" ? "str" : schema.type === "boolean" ? "bool" : "float";
      checks.push(type === "float" ? `is_number(${value})` : `isinstance(${value}, ${type})`);
      if (schema.type === "integer") checks.push(`abs(${value}) <= 9007199254740991`, `(isinstance(${value}, int) or ${value}.is_integer())`);
      for (const [key, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
        if (schema[key] !== undefined) checks.push(`${key.endsWith("Length") ? `code_point_length(${value})` : value} ${operator} ${literal(schema[key])}`);
      }
    }
    if (schema.enum !== undefined) {
      const values = schema.enum as (string | number | boolean)[];
      // Python Literal excludes fractional numbers. Keep their JSON number type
      // and emit the exact enum guard instead of claiming raw floats are Enums.
      if (!values.some(v => typeof v === "number" && !Number.isSafeInteger(v))) {
        type = `Literal[${values.map(literal).join(", ")}]`;
      }
      checks.push(`(${values.map(v => `${value} ${typeof v === "boolean" ? "is" : "=="} ${literal(v)}`).join(" or ")})`);
    }
    const check = `(${checks.join(" and ")})`;
    return schema.nullable === true ? { type: `${type} | None`, check: `(${value} is None or ${check})`, encode: `(None if ${value} is None else ${encode})` } : { type, check, encode };
  };
  for (const op of contract.operations) {
    const name = op.name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    const stem = op.name[0]!.toUpperCase() + op.name.slice(1);
    const inputName = nameFor(stem + "Input");
    const outputName = nameFor(stem + "Response");
    const input = compile(op.input, nameFor(inputName + "Value"), "value");
    const output = compile(op.output, nameFor(outputName + "Value"), "value");
    declarations.push(`${inputName}: TypeAlias = ${input.type}\n${outputName}: TypeAlias = ${output.type}`);
    let path = literal(op.path);
    for (const p of op.parameters) path += `.replace(${literal("{" + p + "}")}, quote(value[${literal(p)}], safe=""))`;
    functions.push(`${name.toUpperCase()}_STATUS = ${op.status}

def is_${name}_input(value: object) -> TypeGuard[${inputName}]:
    return ${input.check}

def decode_${name}(value: object) -> ${outputName}:
    if not _is_${name}_response(value):
        raise TypeError(${literal("Invalid LOVO " + op.id + " response")})
    return value

def _is_${name}_response(value: object) -> TypeGuard[${outputName}]:
    return ${output.check}

async def ${name}(value: ${inputName}, *, api_key: str, base_url: str, transport: HttpTransport) -> HttpResponse:
    if not is_${name}_input(value):
        raise TypeError(${literal("Invalid LOVO " + op.id + " request")})
    url = urlsplit(base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment:
        raise TypeError("Invalid LOVO base_url")
    target = urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + ${path}, url.query, ""))
    return await transport.send(HttpRequest(${literal(op.method.toUpperCase())}, target,
        {${literal(op.header)}: api_key${op.body ? ', "content-type": "application/json"' : ""}},
        ${op.body ? `json.dumps(${input.encode}, allow_nan=False, separators=(",", ":")).encode("utf-8")` : 'b""'}))
`);
  }
  return `# Generated by codegen/generate-clients.ts from ${contract.sourceUrl}. Do not edit.
import json
from collections.abc import Sequence
from typing import Literal, NotRequired, TypeAlias, TypedDict, TypeGuard
from urllib.parse import quote, urlsplit, urlunsplit

from speechswitch.http import HttpRequest, HttpResponse, HttpTransport
from speechswitch.validation import code_point_length, is_mapping, is_number, is_sequence

DEFAULT_BASE_URL = ${literal(contract.baseUrl)}

${declarations.join("\n\n")}

${functions.join("\n").trimEnd()}
`;
}
