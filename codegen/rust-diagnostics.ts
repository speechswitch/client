import { identity, snake, type LanguageLayout } from "./language-types.ts";
import type { SchemaConstraints, SchemaType } from "./spec-model.ts";
import { arrayItemConstraints } from "./spec-model.ts";

function quoted(value: string): string {
  return JSON.stringify(value).replace(/\\(?:u([0-9a-f]{4})|b|f|[\s\S])/gi, (escape, hex: string | undefined) => hex ? `\\u{${hex}}` : escape === "\\b" ? "\\u{8}" : escape === "\\f" ? "\\u{c}" : escape);
}

/** Generate concrete data projections and specialized diagnostics, not schemas. */
export function rustDiagnostics(layout: LanguageLayout, patterns: Map<string, string>) {
  const declarations: string[] = [];
  const projections = new Map<string, string>();
  const checks = new Map<string, string>();
  function typeName(type: SchemaType): string {
    const name = layout.names.get(identity(type));
    if (!name) throw new TypeError("Missing Rust diagnostic type layout");
    return name;
  }
  function project(type: SchemaType): string {
    const key = identity(type);
    const previous = projections.get(key); if (previous) return previous;
    const name = `diagnostic_value${projections.size}`; projections.set(key, name);
    let body: string;
    switch (type.kind) {
      case "literal": body = type.value === null ? "DiagnosticValue::Null" : `DiagnosticValue::${typeof type.value === "string" ? "String" : typeof type.value === "boolean" ? "Bool" : "Number"}(value.value())`; break;
      case "string": body = "DiagnosticValue::String(value)"; break;
      case "number": body = "DiagnosticValue::Number(*value)"; break;
      case "boolean": body = "DiagnosticValue::Bool(*value)"; break;
      case "bigint": body = "DiagnosticValue::BigInt"; break;
      case "bytes": body = "DiagnosticValue::Bytes"; break;
      case "async-iterable": body = "DiagnosticValue::Input"; break;
      case "json-value": body = "DiagnosticValue::from_json(value)"; break;
      case "empty-tuple": body = "DiagnosticValue::Array(Vec::new())"; break;
      case "array": body = `DiagnosticValue::Array(value.iter().map(${project(type.items)}).collect())`; break;
      case "record": body = `DiagnosticValue::Object(value.iter().map(|(key, item)| (key.as_str(), ${project(type.values)}(item))).collect())`; break;
      case "object": body = ["let mut result = std::collections::BTreeMap::new();", ...type.fields.map(field => {
        const member = `value.${snake(field.name)}`;
        return field.optional ? `if let Some(item) = &${member} { result.insert(${quoted(field.name)}, ${project(field.type)}(item)); }` : `result.insert(${quoted(field.name)}, ${project(field.type)}(&${member}));`;
      }), "DiagnosticValue::Object(result)"].join("\n"); break;
      case "union": body = `match value {\n${layout.variants.get(key)!.map(variant => `${typeName(type)}::${variant.name}(item) => ${project(variant.schema)}(item),`).join("\n")}\n}`; break;
    }
    declarations.push(`fn ${name}(${body.includes("value") ? "value" : "_value"}: &${typeName(type)}) -> DiagnosticValue<'_> {\n${body}\n}`);
    return name;
  }
  function declare(body: string): string {
    const previous = checks.get(body); if (previous) return previous;
    const name = `diagnose${checks.size}`; checks.set(body, name);
    declarations.push(`fn ${name}(value: &DiagnosticValue<'_>, path: &str, errors: &mut Vec<String>) {\n${body}\n}`);
    return name;
  }
  function compile(type: SchemaType, constraints?: SchemaConstraints): string {
    const lines: string[] = [];
    function check(expression: string, message: string, stop = false) {
      lines.push(`if !(${expression}) { errors.push(path.to_owned() + ${quoted(`: ${message}`)});${stop ? " return;" : ""} }`);
    }
    function scalar(kind: string, message: string) {
      lines.push(`let DiagnosticValue::${kind}(scalar) = value else { errors.push(path.to_owned() + ${quoted(`: ${message}`)}); return; };`);
    }
    function literal(value: string | number | boolean | null): string {
      return value === null ? "matches!(value, DiagnosticValue::Null)" : `matches!(value, DiagnosticValue::${typeof value === "string" ? "String" : typeof value === "boolean" ? "Bool" : "Number"}(item) if *item == ${typeof value === "string" ? quoted(value) : typeof value === "number" ? `${value}_f64` : value})`;
    }
    switch (type.kind) {
      case "literal": check(literal(type.value), `expected ${JSON.stringify(type.value)}`, true); break;
      case "string": scalar("String", "expected string"); break;
      case "number": scalar("Number", "expected finite number"); check("scalar.is_finite()", "expected finite number", true); break;
      case "boolean": check("matches!(value, DiagnosticValue::Bool(_))", "expected boolean", true); break;
      case "bigint": check("matches!(value, DiagnosticValue::BigInt)", "expected bigint", true); break;
      case "bytes": check("matches!(value, DiagnosticValue::Bytes)", "expected Uint8Array", true); break;
      case "async-iterable": check("matches!(value, DiagnosticValue::Input)", "expected AsyncIterable", true); break;
      case "json-value": check("value.is_json()", "expected JSON value", true); break;
      case "empty-tuple":
        scalar("Array", "expected array");
        check("scalar.is_empty()", "expected empty array", true);
        break;
      case "array":
        scalar("Array", "expected array");
        lines.push(`for (index, item) in scalar.iter().enumerate() { ${compile(type.items, arrayItemConstraints(constraints))}(item, &format!("{path}[{index}]"), errors); }`);
        break;
      case "record":
        scalar("Object", "expected plain object");
        lines.push(`for (key, item) in scalar { ${compile(type.values)}(item, &(path.to_owned() + "[" + &crate::runtime::diagnostic_key(key) + "]"), errors); }`);
        break;
      case "object":
        scalar("Object", "expected object");
        for (const field of type.fields) {
          const fieldPath = `&(path.to_owned() + ${quoted(`[${JSON.stringify(field.name)}]`)})`;
          lines.push(`if let Some(item) = scalar.get(${quoted(field.name)}) { ${compile(field.type, field.constraints)}(item, ${fieldPath}, errors); }${field.optional ? "" : ` else { errors.push(path.to_owned() + ${quoted(`[${JSON.stringify(field.name)}]: required field`)}); }`}`);
        }
        for (const field of type.forbidden ?? []) lines.push(`if scalar.contains_key(${quoted(field)}) { errors.push(path.to_owned() + ${quoted(`[${JSON.stringify(field)}]: field is not allowed`)}); }`);
        break;
      case "union":
        if (type.anyOf.length && type.anyOf.every(part => part.kind === "literal")) {
          check(type.anyOf.map(part => literal(part.value)).join(" || "), `expected one of ${type.anyOf.map(part => JSON.stringify(part.value)).join(", ")}`, true);
          break;
        }
        if (!type.anyOf.length) { check("false", "no allowed value"); break; }
        lines.push("let start = errors.len();");
        for (const part of type.anyOf) lines.push(`let before = errors.len();\n${compile(part, constraints)}(value, path, errors);\nif errors.len() == before { errors.truncate(start); return; }`);
        return declare(lines.join("\n"));
    }
    if (constraints && (type.kind === "literal" || type.kind === "union")) {
      if (constraints.minimum !== undefined || constraints.exclusiveMinimum !== undefined || constraints.maximum !== undefined || constraints.integer) scalar("Number", "expected finite number");
      else if (constraints.pattern !== undefined || constraints.maxLength !== undefined) scalar("String", "expected string");
    }
    if (constraints?.minimum !== undefined) check(`*scalar >= ${constraints.minimum}_f64`, `expected number >= ${constraints.minimum}`);
    if (constraints?.exclusiveMinimum !== undefined) check(`*scalar > ${constraints.exclusiveMinimum}_f64`, `expected number > ${constraints.exclusiveMinimum}`);
    if (constraints?.integer) check("*scalar >= -9007199254740991_f64 && *scalar <= 9007199254740991_f64 && scalar.trunc() == *scalar", "expected safe integer");
    if (constraints?.maximum !== undefined) check(`*scalar <= ${constraints.maximum}_f64`, `expected number <= ${constraints.maximum}`);
    if (constraints?.pattern !== undefined) {
      let name = patterns.get(constraints.pattern);
      if (!name) { name = `pattern${patterns.size}`; patterns.set(constraints.pattern, name); }
      check(`${name}(&Vec::from_iter(scalar.encode_utf16()))`, `expected string matching ${constraints.pattern}`);
    }
    if (constraints?.maxLength !== undefined) check(`scalar.chars().count() <= ${constraints.maxLength}`, `expected at most ${constraints.maxLength} Unicode code points`);
    if (constraints?.minItems !== undefined) check(`scalar.len() >= ${constraints.minItems}`, `expected at least ${constraints.minItems} items`);
    if (constraints?.maxItems !== undefined) check(`scalar.len() <= ${constraints.maxItems}`, `expected at most ${constraints.maxItems} items`);
    return declare(lines.join("\n").replace(/\bscalar\b/g, lines.filter(line => line.includes("scalar")).length === 1 ? "_scalar" : "scalar"));
  }
  return { declarations, project, compile };
}
