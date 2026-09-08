import type { SchemaConstraints, SchemaType, TtsProviderSpec } from "./spec-model.ts";

/** Compile our normalized authored types, not the provider's wire documentation. */
export function renderRequestValidator(provider: TtsProviderSpec): string {
  const declarations: string[] = [];
  const validators = new Map<string, string>();
  function declare(body: string): string {
    const cached = validators.get(body);
    if (cached) return cached;
    const name = `validate${validators.size}`;
    validators.set(body, name);
    declarations.push(`function ${name}(value: unknown, path: string, errors: string[]): void {\n${body}\n}`);
    return name;
  }
  function union(names: string[]): string {
    if (!names.length) return declare('  errors.push(`${path}: no allowed value`);');
    if (names.length === 1) return names[0]!;
    // Keep failed alternatives in the shared buffer, rolling back only when one succeeds.
    return declare([
      "  const start = errors.length;",
      "  let before: number;",
      ...names.map(name => `  before = errors.length;
  ${name}(value, path, errors);
  if (errors.length === before) { errors.length = start; return; }`),
    ].join("\n"));
  }
  function compile(type: SchemaType, constraints?: SchemaConstraints): string {
    const lines: string[] = [];
    function check(expression: string, message: string, stop = false) {
      lines.push(`  if (!(${expression})) { errors.push(path + ${JSON.stringify(`: ${message}`)});${stop ? " return;" : ""} }`);
    }
    switch (type.kind) {
      case "literal": check(`value === ${JSON.stringify(type.value)}`, `expected ${JSON.stringify(type.value)}`, true); break;
      case "string": check('typeof value === "string"', "expected string", true); break;
      case "number": check('typeof value === "number" && Number.isFinite(value)', "expected finite number", true); break;
      case "boolean": check('typeof value === "boolean"', "expected boolean", true); break;
      case "bigint": check('typeof value === "bigint"', "expected bigint", true); break;
      case "bytes": check("value instanceof Uint8Array", "expected Uint8Array", true); break;
      case "array":
        check("Array.isArray(value)", "expected array", true);
        lines.push(`  for (let index = 0; index < value.length; index++) ${compile(type.items)}(value[index], path + "[" + index + "]", errors);`);
        break;
      case "async-iterable":
        check('(typeof value === "object" || typeof value === "function") && value !== null && Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === "function"', "expected AsyncIterable", true);
        break;
      case "union":
        if (type.anyOf.length && type.anyOf.every(part => part.kind === "literal")) {
          check(type.anyOf.map(part => `value === ${JSON.stringify(part.value)}`).join(" || "), `expected one of ${type.anyOf.map(part => JSON.stringify(part.value)).join(", ")}`, true);
          break;
        }
        return union(type.anyOf.map(part => compile(part, constraints)));
      case "object": {
        check('typeof value === "object" && value !== null && !Array.isArray(value)', "expected object", true);
        for (const field of type.fields) {
          const name = JSON.stringify(field.name);
          const fieldPath = `path + ${JSON.stringify(`[${name}]`)}`;
          const call = `${compile(field.type, field.constraints)}(value[${name}], ${fieldPath}, errors);`;
          lines.push(field.optional
            ? `  if (${name} in value && value[${name}] !== undefined) ${call}`
            : `  if (${name} in value) ${call}\n  else errors.push(${fieldPath} + ": required field");`);
        }
        for (const name of type.forbidden ?? []) {
          const key = JSON.stringify(name);
          lines.push(`  if (${key} in value && value[${key}] !== undefined) errors.push(path + ${JSON.stringify(`[${key}]: field is not allowed`)});`);
        }
        break;
      }
    }
    if (constraints) {
      if (constraints.minimum !== undefined) check(`typeof value === "number" && value >= ${constraints.minimum}`, `expected number >= ${constraints.minimum}`);
      if (constraints.exclusiveMinimum !== undefined) check(`typeof value === "number" && value > ${constraints.exclusiveMinimum}`, `expected number > ${constraints.exclusiveMinimum}`);
      if (constraints.integer) check("Number.isSafeInteger(value)", "expected safe integer");
      if (constraints.maximum !== undefined) check(`typeof value === "number" && value <= ${constraints.maximum}`, `expected number <= ${constraints.maximum}`);
      if (constraints.pattern !== undefined) check(`typeof value === "string" && new RegExp(${JSON.stringify(constraints.pattern)}).test(value)`, `expected string matching ${constraints.pattern}`);
    }
    return declare(lines.join("\n"));
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
  const groups = [...itemGroups.values()].map(group => ({ ...group, matches: union([...group.matches]) }));
  const namedInputs = groups.some(group => group.field !== "text");
  const selector = namedInputs ? ', field?: string' : '';
  // Only unconditional, top-level defaults can be resolved before choosing a variant.
  const defaults = alternatives[0]?.kind === "object" ? alternatives[0].fields.filter(field =>
    field.default !== undefined && alternatives.every(branch => branch.kind === "object"
      && branch.fields.some(other => other.name === field.name && other.default === field.default)),
  ) : [];
  return `// Generated by codegen/generate-spec.ts from schemas/providers/${provider.id}/index.ts. Do not edit.
${defaults.length ? `/** Defaults shared by every request variant. */\nexport const requestDefaults = ${JSON.stringify(Object.fromEntries(defaults.map(field => [field.name, field.default])))} as const;\n` : ""}
${declarations.join("\n\n")}

/** Validate without advancing async input; the returned check validates each item when consumed. */
export function validateRequest(value: unknown): (item: unknown${selector}) => void {
  const errors: string[] = [];
  ${request}(value, "request", errors);
  if (errors.length) throw new TypeError(${JSON.stringify(`Invalid ${provider.id} TTS request`)} + ":\\n" + errors.join("\\n"));
${groups.map(({ matches }, index) => `  ${matches}(value, "request", errors);
  const accepts${index} = errors.length === 0;
  errors.length = 0;`).join("\n")}
  return (item: unknown${namedInputs ? ', field = "text"' : ''}): void => {
    const errors: string[] = [];
${groups.map(({ item, field }, index) => `    if (${namedInputs ? `field === ${JSON.stringify(field)} && ` : ''}accepts${index}) {
      const before = errors.length;
      ${item}(item, ${JSON.stringify(`${field} item`)}, errors);
      if (errors.length === before) return;
    }`).join("\n")}
    if (!errors.length) errors.push(${namedInputs ? 'field + " item: streaming input is not supported by this request"' : '"text item: streaming input is not supported by this request"'});
    throw new TypeError(${JSON.stringify(`Invalid ${provider.id} TTS input item`)} + ":\\n" + errors.join("\\n"));
  };
}
`;
}
