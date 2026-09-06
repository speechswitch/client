import type { SchemaConstraints, SchemaType, TtsProviderSpec } from "./spec-model.ts";

/** Compile our normalized authored types, not the provider's wire documentation. */
export function renderRequestValidator(provider: TtsProviderSpec): string {
  const declarations: string[] = [];
  const predicates = new Map<string, string>();
  let json = false;
  function compile(type: SchemaType, constraints?: SchemaConstraints): string {
    let expression: string;
    let itemCheck: string | undefined;
    switch (type.kind) {
      case "literal": expression = `value === ${JSON.stringify(type.value)}`; break;
      case "string": expression = 'typeof value === "string"'; break;
      case "number": expression = 'typeof value === "number" && Number.isFinite(value)'; break;
      case "boolean": expression = 'typeof value === "boolean"'; break;
      case "bigint": expression = 'typeof value === "bigint"'; break;
      case "bytes": expression = "value instanceof Uint8Array"; break;
      case "json-value": json = true; expression = "isJsonValue(value)"; break;
      case "record": expression = `typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) && Object.values(value).every(${compile(type.values)})`; break;
      case "array": itemCheck = compile(type.items); expression = "Array.isArray(value)"; break;
      case "async-iterable": expression = '(typeof value === "object" || typeof value === "function") && value !== null && Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === "function"'; break;
      case "union": expression = `(${type.anyOf.map(part => `${compile(part, constraints)}(value)`).join(" || ") || "false"})`; break;
      case "object": {
        const fields = type.fields.map(field => {
          const name = JSON.stringify(field.name);
          const check = `${compile(field.type, field.constraints)}(value[${name}])`;
          return field.optional ? `(!(${name} in value) || value[${name}] === undefined || ${check})` : `(${name} in value && ${check})`;
        });
        const forbidden = (type.forbidden ?? []).map(name => `(!(${JSON.stringify(name)} in value) || value[${JSON.stringify(name)}] === undefined)`);
        expression = ['typeof value === "object"', 'value !== null', '!Array.isArray(value)', ...fields, ...forbidden].join(" && ");
        break;
      }
    }
    if (constraints && type.kind !== "union") {
      if (constraints.minimum !== undefined || constraints.exclusiveMinimum !== undefined || constraints.maximum !== undefined || constraints.integer) {
        expression += ' && typeof value === "number"';
        if (constraints.minimum !== undefined) expression += ` && value >= ${constraints.minimum}`;
        if (constraints.exclusiveMinimum !== undefined) expression += ` && value > ${constraints.exclusiveMinimum}`;
        if (constraints.integer) expression += ` && Number.isSafeInteger(value)`;
        if (constraints.maximum !== undefined) expression += ` && value <= ${constraints.maximum}`;
      }
      if (constraints.pattern !== undefined) expression += ` && typeof value === "string" && new RegExp(${JSON.stringify(constraints.pattern)}).test(value)`;
      if (constraints.maxLength !== undefined) expression += ` && typeof value === "string" && Array.from(value).length <= ${constraints.maxLength}`;
      if (constraints.minItems !== undefined) expression += ` && Array.isArray(value) && value.length >= ${constraints.minItems}`;
      if (constraints.maxItems !== undefined) expression += ` && Array.isArray(value) && value.length <= ${constraints.maxItems}`;
    }
    // Index every element: Array.every would silently accept sparse holes.
    const body = itemCheck === undefined ? `  return ${expression};` : `  if (!(${expression})) return false;\n  for (let index = 0; index < value.length; index++) if (!${itemCheck}(value[index])) return false;\n  return true;`;
    const cached = predicates.get(body);
    if (cached) return cached;
    const name = `valid${predicates.size}`;
    predicates.set(body, name);
    declarations.push(`function ${name}(value: unknown): boolean {\n${body}\n}`);
    return name;
  }
  const request = compile(provider.request);
  const alternatives = provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
  const itemGroups = new Map<string, { field: string; item: string; matches: Set<string> }>();
  for (const branch of alternatives) {
    if (branch.kind !== "object") throw new TypeError("Request validators require object variants");
    for (const field of branch.fields) for (const part of field.type.kind === "union" ? field.type.anyOf : [field.type]) {
      if (part.kind !== "async-iterable") continue;
      const item = compile(part.items);
      const key = JSON.stringify([field.name, item]);
      const group = itemGroups.get(key) ?? { field: field.name, item, matches: new Set<string>() };
      group.matches.add(compile(branch)); itemGroups.set(key, group);
    }
  }
  const groups = [...itemGroups.values()];
  const namedInputs = groups.some(group => group.field !== "text");
  const selector = namedInputs ? ', field?: string' : '';
  // Only unconditional, top-level defaults can be resolved before choosing a variant.
  const defaults = alternatives[0]?.kind === "object" ? alternatives[0].fields.filter(field =>
    field.default !== undefined && alternatives.every(branch => branch.kind === "object"
      && branch.fields.some(other => other.name === field.name && other.default === field.default)),
  ) : [];
  return `// Generated by codegen/generate-spec.ts from schemas/providers/${provider.id}/index.ts. Do not edit.${json ? '\nimport { isJsonValue } from "../../runtime/json.ts";' : ""}
${defaults.length ? `/** Defaults shared by every request variant. */\nexport const requestDefaults = ${JSON.stringify(Object.fromEntries(defaults.map(field => [field.name, field.default])))} as const;\n` : ""}
${declarations.join("\n\n")}

/** Validate without advancing async input; the returned check validates each item when consumed. */
export function validateRequest(value: unknown): (item: unknown${selector}) => void {
  if (!${request}(value)) throw new TypeError(${JSON.stringify(`Invalid ${provider.id} TTS request`)});
${groups.map(({ matches }, index) => `  const accepts${index} = ${[...matches].map(name => `${name}(value)`).join(" || ")};`).join("\n")}
  return (item: unknown${namedInputs ? ', field = "text"' : ''}): void => {
    if (!(${groups.map(({ item, field }, index) => `(${namedInputs ? `field === ${JSON.stringify(field)} && ` : ''}accepts${index} && ${item}(item))`).join(" || ") || "false"})) throw new TypeError(${JSON.stringify(`Invalid ${provider.id} TTS input item`)});
  };
}
`;
}
