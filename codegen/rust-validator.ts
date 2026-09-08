import { compileLanguageTypes, identity, snake, type LanguageLayout } from "./language-types.ts";
import { renderRustPattern } from "./rust-pattern.ts";
import { rustDiagnostics } from "./rust-diagnostics.ts";
import type { SchemaConstraints, SchemaType, TtsProviderSpec } from "./spec-model.ts";
import { arrayItemConstraints } from "./spec-model.ts";

/** Validate the exact generated Rust representation without retaining its borrow. */
export function renderRustValidator(provider: TtsProviderSpec, layout: LanguageLayout = compileLanguageTypes(provider.request, "rust", provider.id)): string {
  const declarations: string[] = [];
  const names = new Map<string, string>();
  const patterns = new Map<string, string>();
  const diagnostics = rustDiagnostics(layout, patterns);
  function typeName(type: SchemaType): string {
    const name = layout.names.get(identity(type));
    if (!name) throw new TypeError("Missing generated Rust type layout");
    return name;
  }
  function compile(type: SchemaType, constraints?: SchemaConstraints): string {
    const key = JSON.stringify([identity(type), constraints]);
    const cached = names.get(key); if (cached) return cached;
    const name = `valid${names.size}`; names.set(key, name);
    const scalar = type.kind === "literal" ? "value.value()" : "(*value)";
    const checks: string[] = [];
    switch (type.kind) {
      case "string": case "bytes": case "literal": case "boolean": case "bigint": case "async-iterable": break;
      case "number": checks.push("value.is_finite()"); break;
      case "json-value": checks.push("crate::runtime::is_json_value(value)"); break;
      case "object": for (const field of type.fields) {
        const member = `value.${snake(field.name)}`;
        const check = compile(field.type, field.constraints);
        checks.push(field.optional ? `${member}.as_ref().map_or(true, ${check})` : `${check}(&${member})`);
      } break;
      case "array": checks.push(`value.iter().all(${compile(type.items, arrayItemConstraints(constraints))})`); break;
      case "record": checks.push(`value.values().all(${compile(type.values)})`); break;
      case "union": {
        const variants = layout.variants.get(identity(type));
        if (!variants) throw new TypeError("Missing Rust union layout");
        declarations.push(`fn ${name}(value: &${typeName(type)}) -> bool {\nmatch value {\n${variants.map(variant => `${typeName(type)}::${variant.name}(value) => ${compile(variant.schema, constraints)}(value),`).join("\n")}\n}\n}`);
        return name;
      }
    }
    const bounds: string[] = [];
    if (constraints?.minimum !== undefined) bounds.push(`${scalar} >= ${constraints.minimum}_f64`);
    if (constraints?.exclusiveMinimum !== undefined) bounds.push(`${scalar} > ${constraints.exclusiveMinimum}_f64`);
    if (constraints?.maximum !== undefined) bounds.push(`${scalar} <= ${constraints.maximum}_f64`);
    if (constraints?.integer) bounds.push(`${scalar} >= -9007199254740991_f64 && ${scalar} <= 9007199254740991_f64 && ${scalar}.trunc() == ${scalar}`);
    if (constraints?.pattern !== undefined) {
      let pattern = patterns.get(constraints.pattern);
      if (!pattern) { pattern = `pattern${patterns.size}`; patterns.set(constraints.pattern, pattern); }
      bounds.push(`${pattern}(&Vec::from_iter(${scalar}.encode_utf16()))`);
    }
    if (constraints?.maxLength !== undefined) bounds.push(`${scalar}.chars().count() <= ${constraints.maxLength}`);
    if (constraints?.minItems !== undefined) bounds.push(`value.len() >= ${constraints.minItems}`);
    if (constraints?.maxItems !== undefined) bounds.push(`value.len() <= ${constraints.maxItems}`);
    // Bound collections before traversing elements; no predicate touches producers.
    const expression = [...bounds, ...checks].join(" && ") || "true";
    declarations.push(`fn ${name}(${expression === "true" ? "_value" : "value"}: &${typeName(type)}) -> bool {\n${expression}\n}`);
    return name;
  }
  const request = compile(provider.request);
  const branches = provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
  const groups: { field: string; item: SchemaType; conditions: Map<string, string> }[] = [];
  for (const branch of branches) {
    if (branch.kind !== "object") throw new TypeError("Request validators require object variants");
    for (const field of branch.fields) for (const part of field.type.kind === "union" ? field.type.anyOf : [field.type]) {
      if (part.kind !== "async-iterable") continue;
      let group = groups.find(group => group.field === field.name && identity(group.item) === identity(part.items));
      if (!group) { group = { field: field.name, item: part.items, conditions: new Map() }; groups.push(group); }
      const member = `value.${snake(field.name)}`;
      let condition = field.optional ? `${member}.is_some()` : "true";
      if (field.type.kind === "union") {
        const variant = layout.variants.get(identity(field.type))!.find(variant => identity(variant.schema) === identity(part))!;
        const pattern = `${typeName(field.type)}::${variant.name}(_)`;
        condition = `matches!(&${member}, ${field.optional ? `Some(${pattern})` : pattern})`;
      }
      group.conditions.set(identity(branch), condition);
      compile(part.items);
    }
  }
  const selection = groups.map((group, index) => {
    const condition = provider.request.kind === "union"
      ? `match value {\n${layout.variants.get(identity(provider.request))!.map(variant => {
        const body = group.conditions.get(identity(variant.schema)) ?? "false";
        return `${typeName(provider.request)}::${variant.name}(${body.includes("value.") ? "value" : "_"}) => ${body},`;
      }).join("\n")}\n}` : group.conditions.get(identity(provider.request))!;
    return `let accepts${index} = ${condition};`;
  }).join("\n");
  const requestData = diagnostics.project(provider.request);
  const requestDiagnostic = diagnostics.compile(provider.request);
  const inputChecks = groups.map((group, index) => `if accepts${index} && field == ${JSON.stringify(group.field)} {
    let typed = item.downcast_ref::<${typeName(group.item)}>();
    if typed.map_or(false, ${compile(group.item)}) { return Ok(()); }
    let data = typed.map_or_else(|| DiagnosticValue::from_any(item), ${diagnostics.project(group.item)});
    let before = messages.len();
    ${diagnostics.compile(group.item)}(&data, &(field.to_owned() + " item"), &mut messages);
    if messages.len() == before { messages.push(field.to_owned() + " item: expected generated input representation"); }
  }`).join("\n");
  return `// Generated by codegen/generate-language-types.ts from schemas/. Do not edit.
use crate::generated::${snake(provider.id)}::*;
use crate::runtime::{ValidationError, DiagnosticValue};

${declarations.join("\n\n")}

${diagnostics.declarations.join("\n\n")}

${[...patterns].map(([source, name]) => renderRustPattern(source, name)).join("\n")}

/// Check the request without consuming input or inserting defaults.
/// The returned checker owns only selection flags, not the request or its stream.
/// Pass None for the canonical "text" input, or Some(field) for a named input.
pub fn validate_request(value: &TtsRequest) -> Result<impl Fn(&dyn std::any::Any, Option<&str>) -> Result<(), ValidationError>, ValidationError> {
    if !${request}(value) {
        let mut messages = Vec::new();
        ${requestDiagnostic}(&${requestData}(value), "request", &mut messages);
        if !messages.is_empty() { return Err(ValidationError(${JSON.stringify(`Invalid ${provider.id} TTS request:\n`)}.to_owned() + &messages.join("\\n"))); }
    }
${selection}
    Ok(move |${groups.length ? "item" : "_item"}: &dyn std::any::Any, field: Option<&str>| {
        let field = field.unwrap_or("text");
        let mut messages = Vec::new();
${inputChecks}
        if messages.is_empty() { messages.push(field.to_owned() + " item: streaming input is not supported by this request"); }
        Err(ValidationError(${JSON.stringify(`Invalid ${provider.id} TTS input item:\n`)}.to_owned() + &messages.join("\\n")))
    })
}
`;
}
