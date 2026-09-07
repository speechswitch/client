import { compileLanguageTypes, identity, pascal, snake, type LanguageLayout } from "./language-types.ts";
import { renderGoPattern } from "./go-pattern.ts";
import type { SchemaConstraints, SchemaType, TtsProviderSpec } from "./spec-model.ts";
import { arrayItemConstraints } from "./spec-model.ts";

/** Validate the concrete generated Go representation, without reflection over schemas. */
export function renderGoValidator(provider: TtsProviderSpec, layout: LanguageLayout = compileLanguageTypes(provider.request, "go", provider.id)): string {
  const declarations: string[] = [];
  const names = new Map<string, string>();
  const patterns = new Map<string, string>();
  const imports = new Set(["errors", "github.com/speechswitch/client/sdks/go/runtime"]);
  function typeName(type: SchemaType): string {
    const name = layout.names.get(identity(type));
    if (!name) throw new TypeError("Missing generated Go type layout");
    return name;
  }
  function compile(type: SchemaType, constraints?: SchemaConstraints): string {
    const key = JSON.stringify([identity(type), constraints]);
    const cached = names.get(key); if (cached) return cached;
    const name = `valid${names.size}`; names.set(key, name);
    const scalar = type.kind === "literal" ? "value.Value()" : "value";
    let expression = "true"; let body = "";
    switch (type.kind) {
      case "string": imports.add("unicode/utf8"); expression = "utf8.ValidString(value)"; break;
      case "number": imports.add("math"); expression = "!math.IsNaN(value) && !math.IsInf(value, 0)"; break;
      case "bigint": imports.add("math/big"); expression = "value != nil"; break;
      case "bytes": case "literal": case "boolean": case "empty-tuple": break;
      case "async-iterable": expression = "!runtime.IsNilInput(value)"; break;
      case "json-value": expression = "runtime.IsJSONValue(value)"; break;
      case "object": expression = type.fields.map(field => {
        const member = `value.${pascal(field.name)}`;
        const check = `${compile(field.type, field.constraints)}(${member}${field.optional ? ".Value" : ""})`;
        return field.optional ? `(!${member}.Present || ${check})` : check;
      }).join(" && ") || "true"; break;
      case "array": body = `for _, item := range value { if !${compile(type.items, arrayItemConstraints(constraints))}(item) { return false } }\n`; break;
      case "record": imports.add("unicode/utf8"); body = `for key, item := range value { if !utf8.ValidString(key) || !${compile(type.values)}(item) { return false } }\n`; break;
      case "union": {
        const variants = layout.variants.get(identity(type));
        if (!variants) throw new TypeError("Missing Go union layout");
        body = `switch value := value.(type) {\n${variants.map(variant => {
          const check = compile(variant.schema, constraints);
          return `case ${variant.wrapper}: return ${check}(value.Value)\ncase *${variant.wrapper}: return value != nil && ${check}(value.Value)`;
        }).join("\n")}\ndefault: return false\n}`;
        declarations.push(`func ${name}(value ${typeName(type)}) bool {\n${body}\n}`);
        return name;
      }
    }
    if (constraints?.minimum !== undefined) expression += ` && ${scalar} >= ${constraints.minimum}`;
    if (constraints?.exclusiveMinimum !== undefined) expression += ` && ${scalar} > ${constraints.exclusiveMinimum}`;
    if (constraints?.maximum !== undefined) expression += ` && ${scalar} <= ${constraints.maximum}`;
    if (constraints?.integer) { imports.add("math"); expression += ` && ${scalar} >= -9007199254740991 && ${scalar} <= 9007199254740991 && math.Trunc(${scalar}) == ${scalar}`; }
    if (constraints?.pattern !== undefined) {
      imports.add("unicode/utf16");
      let pattern = patterns.get(constraints.pattern);
      if (!pattern) { pattern = `pattern${patterns.size}`; patterns.set(constraints.pattern, pattern); }
      expression += ` && ${pattern}(utf16.Encode([]rune(${scalar})))`;
    }
    if (constraints?.maxLength !== undefined) { imports.add("unicode/utf8"); expression += ` && utf8.RuneCountInString(${scalar}) <= ${constraints.maxLength}`; }
    if (constraints?.minItems !== undefined) expression += ` && len(value) >= ${constraints.minItems}`;
    if (constraints?.maxItems !== undefined) expression += ` && len(value) <= ${constraints.maxItems}`;
    declarations.push(`func ${name}(value ${typeName(type)}) bool {\n${body ? `if !(${expression}) { return false }\n${body}return true` : `return ${expression}`}\n}`);
    return name;
  }
  const request = compile(provider.request);
  const branches = provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
  const groups: { field: string; item: SchemaType; branches: Map<string, string> }[] = [];
  for (const branch of branches) {
    if (branch.kind !== "object") throw new TypeError("Request validators require object variants");
    for (const field of branch.fields) for (const part of field.type.kind === "union" ? field.type.anyOf : [field.type]) {
      if (part.kind !== "async-iterable") continue;
      let group = groups.find(group => group.field === field.name && identity(group.item) === identity(part.items));
      if (!group) { group = { field: field.name, item: part.items, branches: new Map() }; groups.push(group); }
      const member = `value.${pascal(field.name)}`;
      let condition = "true";
      if (field.type.kind === "union") {
        const active = `activeInput${declarations.length}`;
        const variants = layout.variants.get(identity(field.type))!.filter(variant => identity(variant.schema) === identity(part));
        declarations.push(`func ${active}(value ${typeName(field.type)}) bool {\nswitch value := value.(type) {\n${variants.map(variant => `case ${variant.wrapper}: return true\ncase *${variant.wrapper}: return value != nil`).join("\n")}\ndefault: return false\n}\n}`);
        condition = `${active}(${member}${field.optional ? ".Value" : ""})`;
      }
      group.branches.set(identity(branch), field.optional ? `${member}.Present && ${condition}` : condition);
      compile(part.items);
    }
  }
  function activate(branch: SchemaType): string {
    return groups.flatMap((group, index) => {
      const condition = group.branches.get(identity(branch));
      return condition === undefined ? [] : [`accepts${index} = ${condition}`];
    }).join("\n");
  }
  const selection = groups.length === 0 ? "" : provider.request.kind === "union"
    ? `switch value := value.(type) {\n${layout.variants.get(identity(provider.request))!.map(variant => {
      const body = activate(variant.schema).replaceAll("value.", "value.Value.");
      return `case ${variant.wrapper}:\n_ = value\n${body}\ncase *${variant.wrapper}:\n_ = value\n${body}`;
    }).join("\n")}\n}` : activate(provider.request);
  const inputChecks = groups.map((group, index) => `if accepts${index} && field == ${JSON.stringify(group.field)} { if item, ok := item.(${typeName(group.item)}); ok && ${compile(group.item)}(item) { return nil } }`).join("\n");
  return `// Generated by codegen/generate-language-types.ts from schemas/. Do not edit.
package ${snake(provider.id)}

import (\n${[...imports].sort().map(name => JSON.stringify(name)).join("\n")}\n)

${declarations.join("\n\n")}

${[...patterns].map(([source, name]) => renderGoPattern(source, name)).join("\n")}

// ValidateRequest checks the generated request without consuming input or inserting defaults.
// Use its result for each consumed item; field defaults to the canonical name "text".
func ValidateRequest(value TtsRequest) (runtime.InputValidator, error) {
    if !${request}(value) { return nil, errors.New(${JSON.stringify(`Invalid ${provider.id} TTS request`)}) }
${groups.map((_, index) => `var accepts${index} bool`).join("\n")}
${selection}
    return func(item any, fields ...string) error {
        field := "text"
        if len(fields) == 1 { field = fields[0] }
        if len(fields) > 1 { return errors.New(${JSON.stringify(`Invalid ${provider.id} TTS input item`)}) }
        _ = field
${inputChecks}
        return errors.New(${JSON.stringify(`Invalid ${provider.id} TTS input item`)})
    }, nil
}
`;
}
