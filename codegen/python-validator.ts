import { snake } from "./language-types.ts";
import { pythonPattern } from "./python-pattern.ts";
import type { SchemaConstraints, SchemaLiteral, SchemaType, TtsProviderSpec } from "./spec-model.ts";

function literal(value: SchemaLiteral): string {
  return value === null ? "None" : value === true ? "True" : value === false ? "False" : JSON.stringify(value);
}

function disjunction(expressions: readonly string[]): string {
  // Keep Python/Pyright expression depth bounded for large model/language unions.
  if (expressions.length <= 16) return `(${expressions.join(" or ") || "False"})`;
  const middle = Math.floor(expressions.length / 2);
  return `(${disjunction(expressions.slice(0, middle))} or ${disjunction(expressions.slice(middle))})`;
}

/** Specialized predicates from the checked graph; no runtime schema interpreter. */
export function renderPythonValidator(provider: TtsProviderSpec): string {
  const declarations: string[] = [];
  const predicates = new Map<string, string>();
  const patterns = new Map<string, string>();
  function compile(type: SchemaType, constraints?: SchemaConstraints): string {
    let expression: string;
    let itemCheck: string | undefined;
    switch (type.kind) {
      case "literal": expression = type.value === null ? "value is None"
        : typeof type.value === "boolean" ? `value is ${literal(type.value)}`
        : `${typeof type.value === "number" ? "is_number(value)" : "isinstance(value, str)"} and value == ${literal(type.value)}`; break;
      case "string": expression = "isinstance(value, str)"; break;
      case "number": expression = "is_number(value)"; break;
      case "boolean": expression = "isinstance(value, bool)"; break;
      case "bigint": expression = "isinstance(value, int) and not isinstance(value, bool)"; break;
      case "bytes": expression = "isinstance(value, bytes)"; break;
      case "json-value": expression = "is_json_value(value)"; break;
      case "record": expression = `is_mapping(value) and all(isinstance(key, str) and ${compile(type.values)}(item) for key, item in value.items())`; break;
      case "array": itemCheck = compile(type.items); expression = "is_sequence(value)"; break;
      case "async-iterable": expression = 'callable(getattr(value, "__aiter__", None))'; break;
      case "union": expression = disjunction(type.anyOf.map(part => `${compile(part, constraints)}(value)`)); break;
      case "object": {
        const fields = type.fields.map(field => {
          const name = JSON.stringify(snake(field.name));
          const check = `${compile(field.type, field.constraints)}(value[${name}])`;
          return field.optional ? `(${name} not in value or ${check})` : `(${name} in value and ${check})`;
        });
        expression = ["is_mapping(value)", ...fields, ...(type.forbidden ?? []).map(name => `${JSON.stringify(snake(name))} not in value`)].join(" and ");
        break;
      }
    }
    if (constraints && type.kind !== "union") {
      if (constraints.minimum !== undefined) expression += ` and value >= ${constraints.minimum}`;
      if (constraints.exclusiveMinimum !== undefined) expression += ` and value > ${constraints.exclusiveMinimum}`;
      if (constraints.maximum !== undefined) expression += ` and value <= ${constraints.maximum}`;
      if (constraints.integer) expression += " and -9007199254740991 <= value <= 9007199254740991 and value % 1 == 0";
      if (constraints.pattern !== undefined) {
        let name = patterns.get(constraints.pattern);
        if (!name) { name = `_pattern${patterns.size}`; patterns.set(constraints.pattern, name); }
        expression += ` and ${name}.search(utf16_units(value)) is not None`;
      }
      if (constraints.maxLength !== undefined) expression += ` and code_point_length(value) <= ${constraints.maxLength}`;
      if (constraints.minItems !== undefined) expression += ` and len(value) >= ${constraints.minItems}`;
      if (constraints.maxItems !== undefined) expression += ` and len(value) <= ${constraints.maxItems}`;
    }
    if (itemCheck !== undefined) expression += ` and all(${itemCheck}(item) for item in value)`;
    const previous = predicates.get(expression); if (previous) return previous;
    const name = `_valid${predicates.size}`; predicates.set(expression, name);
    declarations.push(`def ${name}(value: object) -> bool:\n    return ${expression}`);
    return name;
  }
  const request = compile(provider.request);
  const alternatives = provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
  const groups = new Map<string, { field: string; item: string; matches: Set<string> }>();
  for (const branch of alternatives) {
    if (branch.kind !== "object") throw new TypeError("Request validators require object variants");
    for (const field of branch.fields) for (const part of field.type.kind === "union" ? field.type.anyOf : [field.type]) {
      if (part.kind !== "async-iterable") continue;
      const item = compile(part.items); const key = JSON.stringify([field.name, item]);
      const group = groups.get(key) ?? { field: snake(field.name), item, matches: new Set<string>() };
      group.matches.add(compile(branch)); groups.set(key, group);
    }
  }
  const inputs = [...groups.values()];
  return `# Generated by codegen/generate-language-types.ts from schemas/. Do not edit.
import re
from speechswitch.validation import InputValidator, is_number, is_mapping, is_sequence, is_json_value, utf16_units, code_point_length

${[...patterns].map(([pattern, name]) => `${name} = re.compile(${JSON.stringify(pythonPattern(pattern))})`).join("\n")}

${declarations.join("\n\n")}

def validate_request(value: object) -> InputValidator:
    """Validate without advancing input or inserting defaults; check items when consumed."""
    if not ${request}(value):
        raise TypeError(${JSON.stringify(`Invalid ${provider.id} TTS request`)})
${inputs.map(({ matches }, index) => `    accepts${index} = ${disjunction([...matches].map(name => `${name}(value)`))}`).join("\n")}
    def validate_input(item: object, field: str = "text") -> None:
        if not ${disjunction(inputs.map(({ field, item }, index) => `(field == ${JSON.stringify(field)} and accepts${index} and ${item}(item))`))}:
            raise TypeError(${JSON.stringify(`Invalid ${provider.id} TTS input item`)})
    return validate_input
`;
}
