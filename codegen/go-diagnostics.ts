import { identity, pascal, type LanguageLayout } from "./language-types.ts";
import type { SchemaConstraints, SchemaType } from "./spec-model.ts";
import { arrayItemConstraints } from "./spec-model.ts";

/** Diagnostic-only data projections preserve the public concrete Go types.
 * The emitted checks are specialized code, never runtime schema descriptors. */
export function goDiagnostics(layout: LanguageLayout, imports: Set<string>, patterns: Map<string, string>) {
  const declarations: string[] = [];
  const projections = new Map<string, string>();
  const checks = new Map<string, string>();
  function typeName(type: SchemaType): string {
    const name = layout.names.get(identity(type));
    if (!name) throw new TypeError("Missing Go diagnostic type layout");
    return name;
  }
  function project(type: SchemaType): string {
    const key = identity(type);
    const previous = projections.get(key); if (previous) return previous;
    const name = `diagnosticValue${projections.size}`; projections.set(key, name);
    let body: string;
    switch (type.kind) {
      case "literal": body = type.value === null ? "return nil" : "return value.Value()"; break;
      case "string": case "number": case "boolean": case "bytes": body = "return value"; break;
      case "bigint": imports.add("math/big"); body = "if value == nil { return runtime.InvalidDiagnosticValue{} }; return value"; break;
      case "async-iterable": body = "if runtime.IsNilInput(value) { return nil }; return runtime.DiagnosticInput{}"; break;
      case "json-value": body = "return runtime.DiagnosticJSON(value)"; break;
      case "array": body = `result := make([]any, len(value))\nfor index, item := range value { result[index] = ${project(type.items)}(item) }\nreturn result`; break;
      case "record": body = `result := make(map[string]any, len(value))\nfor key, item := range value { result[key] = ${project(type.values)}(item) }\nreturn result`; break;
      case "object": body = ["result := map[string]any{}", ...type.fields.map(field => {
        const member = `value.${pascal(field.name)}`;
        const line = `result[${JSON.stringify(field.name)}] = ${project(field.type)}(${member}${field.optional ? ".Value" : ""})`;
        return field.optional ? `if ${member}.Present { ${line} }` : line;
      }), "return result"].join("\n"); break;
      case "union": body = `switch value := value.(type) {\n${layout.variants.get(key)!.map(variant => {
        const convert = project(variant.schema);
        return `case ${variant.wrapper}: return ${convert}(value.Value)\ncase *${variant.wrapper}: if value != nil { return ${convert}(value.Value) }`;
      }).join("\n")}\n}\nreturn runtime.InvalidDiagnosticValue{}`; break;
    }
    declarations.push(`func ${name}(value ${typeName(type)}) any {\n${body}\n}`);
    return name;
  }
  function declare(body: string): string {
    const previous = checks.get(body); if (previous) return previous;
    const name = `diagnose${checks.size}`; checks.set(body, name);
    declarations.push(`func ${name}(value any, path string, errors *[]string) {\n${body}\n}`);
    return name;
  }
  function union(names: readonly string[]): string {
    if (!names.length) return declare(' *errors = append(*errors, path + ": no allowed value")');
    if (names.length === 1) return names[0]!;
    return declare(["start := len(*errors)", "var before int", ...names.map(name =>
      `before = len(*errors)\n${name}(value, path, errors)\nif len(*errors) == before { *errors = (*errors)[:start]; return }`)].join("\n"));
  }
  function compile(type: SchemaType, constraints?: SchemaConstraints): string {
    const lines: string[] = [];
    function check(expression: string, message: string, stop = false) {
      lines.push(`if !(${expression}) { *errors = append(*errors, path + ${JSON.stringify(`: ${message}`)});${stop ? " return" : ""} }`);
    }
    function scalar(kind: string, condition: string, message: string) {
      lines.push(`scalar, ok := value.(${kind})`);
      check(`ok${condition ? ` && ${condition}` : ""}`, message, true);
      lines.push("_ = scalar");
    }
    switch (type.kind) {
      case "literal":
        if (type.value === null) check("value == nil", "expected null", true);
        else scalar(typeof type.value === "number" ? "float64" : typeof type.value === "boolean" ? "bool" : "string", `scalar == ${JSON.stringify(type.value)}`, `expected ${JSON.stringify(type.value)}`);
        break;
      case "string": imports.add("unicode/utf8"); scalar("string", "utf8.ValidString(scalar)", "expected string"); break;
      case "number": imports.add("math"); scalar("float64", "!math.IsNaN(scalar) && !math.IsInf(scalar, 0)", "expected finite number"); break;
      case "boolean": scalar("bool", "", "expected boolean"); break;
      case "bigint": imports.add("math/big"); scalar("*big.Int", "scalar != nil", "expected bigint"); break;
      case "bytes": scalar("[]byte", "", "expected Uint8Array"); break;
      case "async-iterable": scalar("runtime.DiagnosticInput", "", "expected AsyncIterable"); break;
      case "json-value": check("runtime.IsDiagnosticJSON(value)", "expected JSON value", true); break;
      case "array":
        scalar("[]any", "", "expected array"); imports.add("strconv");
        lines.push(`for index, item := range scalar { ${compile(type.items, arrayItemConstraints(constraints))}(item, path + "[" + strconv.Itoa(index) + "]", errors) }`);
        break;
      case "record":
        scalar("map[string]any", "", "expected plain object"); imports.add("sort"); imports.add("unicode/utf8");
        lines.push("keys := make([]string, 0, len(scalar))\nfor key := range scalar { keys = append(keys, key) }\nsort.Strings(keys)");
        lines.push(`for _, key := range keys { if !utf8.ValidString(key) { *errors = append(*errors, path + ": expected plain object"); continue }; ${compile(type.values)}(scalar[key], path + "[" + runtime.DiagnosticKey(key) + "]", errors) }`);
        break;
      case "object":
        scalar("map[string]any", "", "expected object");
        for (const field of type.fields) {
          const fieldPath = `path + ${JSON.stringify(`[${JSON.stringify(field.name)}]`)}`;
          lines.push(`if item, present := scalar[${JSON.stringify(field.name)}]; present { ${compile(field.type, field.constraints)}(item, ${fieldPath}, errors) }${field.optional ? "" : ` else { *errors = append(*errors, ${fieldPath} + ": required field") }`}`);
        }
        for (const field of type.forbidden ?? []) lines.push(`if _, present := scalar[${JSON.stringify(field)}]; present { *errors = append(*errors, path + ${JSON.stringify(`[${JSON.stringify(field)}]: field is not allowed`)}) }`);
        break;
      case "union":
        if (type.anyOf.length && type.anyOf.every(part => part.kind === "literal")) {
          // Scalar comparisons are guarded so maps/slices never reach interface equality.
          const kinds = new Set(type.anyOf.map(part => part.value === null ? "null" : typeof part.value));
          const terms: string[] = [];
          for (const kind of kinds) {
            if (kind === "null") { terms.push("value == nil"); continue; }
            const native = kind === "number" ? "float64" : kind === "boolean" ? "bool" : "string";
            lines.push(`${kind}Value, ${kind}OK := value.(${native})`);
            terms.push(`(${kind}OK && (${type.anyOf.filter(part => typeof part.value === kind).map(part => `${kind}Value == ${JSON.stringify(part.value)}`).join(" || ")}))`);
          }
          check(terms.join(" || "), `expected one of ${type.anyOf.map(part => JSON.stringify(part.value)).join(", ")}`, true);
          if (constraints) {
            const kind = [...kinds][0];
            if (kinds.size !== 1 || kind === "null") throw new TypeError("Go diagnostic bounds require homogeneous scalar choices");
            lines.push(`scalar := ${kind}Value\n_ = scalar`);
          }
          break;
        }
        return union(type.anyOf.map(part => compile(part, constraints)));
    }
    if (constraints?.minimum !== undefined) check(`scalar >= ${constraints.minimum}`, `expected number >= ${constraints.minimum}`);
    if (constraints?.exclusiveMinimum !== undefined) check(`scalar > ${constraints.exclusiveMinimum}`, `expected number > ${constraints.exclusiveMinimum}`);
    if (constraints?.integer) { imports.add("math"); check("scalar >= -9007199254740991 && scalar <= 9007199254740991 && math.Trunc(scalar) == scalar", "expected safe integer"); }
    if (constraints?.maximum !== undefined) check(`scalar <= ${constraints.maximum}`, `expected number <= ${constraints.maximum}`);
    if (constraints?.pattern !== undefined) {
      imports.add("unicode/utf16"); let name = patterns.get(constraints.pattern);
      if (!name) { name = `pattern${patterns.size}`; patterns.set(constraints.pattern, name); }
      check(`${name}(utf16.Encode([]rune(scalar)))`, `expected string matching ${constraints.pattern}`);
    }
    if (constraints?.maxLength !== undefined) { imports.add("unicode/utf8"); check(`utf8.RuneCountInString(scalar) <= ${constraints.maxLength}`, `expected at most ${constraints.maxLength} Unicode code points`); }
    if (constraints?.minItems !== undefined) check(`len(scalar) >= ${constraints.minItems}`, `expected at least ${constraints.minItems} items`);
    if (constraints?.maxItems !== undefined) check(`len(scalar) <= ${constraints.maxItems}`, `expected at most ${constraints.maxItems} items`);
    return declare(lines.join("\n"));
  }
  return { declarations, project, compile };
}
