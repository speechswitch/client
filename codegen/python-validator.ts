import { snake } from "./language-types.ts";
import { canonicalPattern } from "./ecmascript-pattern.ts";
import type { SchemaConstraints, SchemaLiteral, SchemaType, TtsProviderSpec } from "./spec-model.ts";
import { arrayItemConstraints } from "./spec-model.ts";

function literal(value: SchemaLiteral): string {
  return value === null ? "None" : value === true ? "True" : value === false ? "False" : JSON.stringify(value);
}

function disjunction(expressions: readonly string[]): string {
  // Large catalog enums must stay below Python/Pyright's expression-depth limit.
  if (expressions.length <= 16) return `(${expressions.join(" or ") || "False"})`;
  const middle = Math.floor(expressions.length / 2);
  return `(${disjunction(expressions.slice(0, middle))} or ${disjunction(expressions.slice(middle))})`;
}

/** Specialized checks with canonical field paths, not a runtime schema interpreter. */
export function renderPythonValidator(provider: TtsProviderSpec): string {
  const declarations: string[] = [];
  const validators = new Map<string, string>();
  const patterns = new Map<string, string>();
  function declare(lines: readonly string[]): string {
    const body = lines.join("\n") || "    pass";
    const previous = validators.get(body); if (previous) return previous;
    const name = `_validate${validators.size}`; validators.set(body, name);
    declarations.push(`def ${name}(value: object, path: str, errors: list[str]) -> None:\n${body}`);
    return name;
  }
  function union(names: readonly string[]): string {
    if (!names.length) return declare(['    errors.append(path + ": no allowed value")']);
    if (names.length === 1) return names[0]!;
    return declare([
      "    start = len(errors)",
      ...names.flatMap(name => ["    before = len(errors)", `    ${name}(value, path, errors)`,
        "    if len(errors) == before:", "        del errors[start:]", "        return"]),
    ]);
  }
  function compile(type: SchemaType, constraints?: SchemaConstraints): string {
    const lines: string[] = [];
    function check(expression: string, message: string, stop = false) {
      lines.push(`    if not (${expression}):`, `        errors.append(path + ${JSON.stringify(`: ${message}`)})`);
      if (stop) lines.push("        return");
    }
    function equals(value: SchemaLiteral): string {
      return value === null ? "value is None" : typeof value === "boolean" ? `value is ${literal(value)}`
        : `${typeof value === "number" ? "is_number(value)" : "isinstance(value, str)"} and value == ${literal(value)}`;
    }
    switch (type.kind) {
      case "literal": check(equals(type.value), `expected ${JSON.stringify(type.value)}`, true); break;
      case "string": check("isinstance(value, str)", "expected string", true); break;
      case "number": check("is_number(value)", "expected finite number", true); break;
      case "boolean": check("isinstance(value, bool)", "expected boolean", true); break;
      case "bigint": check("isinstance(value, int) and not isinstance(value, bool)", "expected bigint", true); break;
      case "bytes": check("isinstance(value, bytes)", "expected Uint8Array", true); break;
      case "json-value": check("is_json_value(value)", "expected JSON value", true); break;
      case "record":
        check("is_mapping(value) and all(isinstance(key, str) for key in value)", "expected plain object", true);
        lines.push("    for key, item in value.items():", `        ${compile(type.values)}(item, path + "[" + json.dumps(key, ensure_ascii=False) + "]", errors)`);
        break;
      case "array":
        check("is_sequence(value)", "expected array", true);
        lines.push("    for index in range(len(value)):", `        ${compile(type.items, arrayItemConstraints(constraints))}(value[index], path + "[" + str(index) + "]", errors)`);
        break;
      case "async-iterable": check('callable(getattr(value, "__aiter__", None))', "expected AsyncIterable", true); break;
      case "union":
        if (type.anyOf.length && type.anyOf.every(part => part.kind === "literal")) {
          const scalar = type.anyOf.every(part => typeof part.value === "string") ? "isinstance(value, str)"
            : type.anyOf.every(part => typeof part.value === "number") ? "is_number(value)" : undefined;
          const expression = scalar ? `${scalar} and value in (${type.anyOf.map(part => literal(part.value)).join(", ")},)`
            : disjunction(type.anyOf.map(part => `(${equals(part.value)})`));
          check(expression, `expected one of ${type.anyOf.map(part => JSON.stringify(part.value)).join(", ")}`, true);
          break;
        }
        return union(type.anyOf.map(part => compile(part, constraints)));
      case "object":
        check("is_mapping(value)", "expected object", true);
        for (const field of type.fields) {
          const key = JSON.stringify(snake(field.name));
          const path = `path + ${JSON.stringify(`[${JSON.stringify(field.name)}]`)}`;
          lines.push(`    if ${key} in value:`, `        ${compile(field.type, field.constraints)}(value[${key}], ${path}, errors)`);
          if (!field.optional) lines.push("    else:", `        errors.append(${path} + ": required field")`);
        }
        for (const field of type.forbidden ?? []) lines.push(`    if ${JSON.stringify(snake(field))} in value:`,
          `        errors.append(path + ${JSON.stringify(`[${JSON.stringify(field)}]: field is not allowed`)})`);
        break;
    }
    if (constraints) {
      if (constraints.minimum !== undefined) check(`is_number(value) and value >= ${constraints.minimum}`, `expected number >= ${constraints.minimum}`);
      if (constraints.exclusiveMinimum !== undefined) check(`is_number(value) and value > ${constraints.exclusiveMinimum}`, `expected number > ${constraints.exclusiveMinimum}`);
      if (constraints.integer) check("is_number(value) and -9007199254740991 <= value <= 9007199254740991 and value % 1 == 0", "expected safe integer");
      if (constraints.maximum !== undefined) check(`is_number(value) and value <= ${constraints.maximum}`, `expected number <= ${constraints.maximum}`);
      if (constraints.pattern !== undefined) {
        let name = patterns.get(constraints.pattern);
        if (!name) { name = `_pattern${patterns.size}`; patterns.set(constraints.pattern, name); }
        check(`${name}.search(utf16_units(value)) is not None`, `expected string matching ${constraints.pattern}`);
      }
      if (constraints.maxLength !== undefined) check(`code_point_length(value) <= ${constraints.maxLength}`, `expected at most ${constraints.maxLength} Unicode code points`);
      if (constraints.minItems !== undefined) check(`is_sequence(value) and len(value) >= ${constraints.minItems}`, `expected at least ${constraints.minItems} items`);
      if (constraints.maxItems !== undefined) check(`is_sequence(value) and len(value) <= ${constraints.maxItems}`, `expected at most ${constraints.maxItems} items`);
    }
    return declare(lines);
  }
  const request = compile(provider.request);
  const alternatives = provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
  const groups = new Map<string, { field: string; item: string; matches: Set<string> }>();
  for (const branch of alternatives) {
    if (branch.kind !== "object") throw new TypeError("Request validators require object variants");
    for (const field of branch.fields) for (const part of field.type.kind === "union" ? field.type.anyOf : [field.type]) {
      if (part.kind !== "async-iterable") continue;
      const item = compile(part.items); const key = JSON.stringify([field.name, item]);
      const group = groups.get(key) ?? { field: field.name, item, matches: new Set<string>() };
      group.matches.add(compile({ ...branch, fields: branch.fields.map(candidate => candidate === field ? { ...candidate, type: part, optional: false } : candidate) })); groups.set(key, group);
    }
  }
  const inputs = [...groups.values()].map(group => ({ ...group, matches: union([...group.matches]) }));
  const named = inputs.some(group => group.field !== "text");
  const defaults = alternatives[0]?.kind === "object" ? alternatives[0].fields.filter(field =>
    field.default !== undefined && alternatives.every(branch => branch.kind === "object"
      && branch.fields.some(other => other.name === field.name && other.default === field.default)),
  ) : [];
  return `# Generated by codegen/generate-language-types.ts from schemas/. Do not edit.
import json
import re
from speechswitch.validation import InputValidator, is_number, is_mapping, is_sequence, is_json_value, utf16_units, code_point_length${defaults.length ? `\n\n# Unconditional defaults shared by every request variant.\nREQUEST_DEFAULTS = {${defaults.map(field => `${JSON.stringify(snake(field.name))}: ${literal(field.default!)}`).join(", ")}}` : ""}

${[...patterns].map(([pattern, name]) => `${name} = re.compile(${JSON.stringify(canonicalPattern(pattern))})`).join("\n")}

${declarations.join("\n\n")}

def validate_request(value: object) -> InputValidator:
    """Validate without advancing input or inserting defaults; paths use canonical schema names."""
    errors: list[str] = []
    ${request}(value, "request", errors)
    if errors:
        raise TypeError(${JSON.stringify(`Invalid ${provider.id} TTS request:\n`)} + "\\n".join(errors))
${inputs.map(({ matches }, index) => `    ${matches}(value, "request", errors)\n    accepts${index} = not errors\n    errors.clear()`).join("\n")}
    def validate_input(item: object, field: str = "text") -> None:
        errors: list[str] = []
${inputs.map(({ field, item }, index) => `        if ${named ? `field == ${JSON.stringify(snake(field))} and ` : ""}accepts${index}:\n            before = len(errors)\n            ${item}(item, ${JSON.stringify(`${field} item`)}, errors)\n            if len(errors) == before:\n                return`).join("\n")}
        if not errors:
            errors.append(${named ? 'field + " item: streaming input is not supported by this request"' : '"text item: streaming input is not supported by this request"'})
        raise TypeError(${JSON.stringify(`Invalid ${provider.id} TTS input item:\n`)} + "\\n".join(errors))
    return validate_input
`;
}
