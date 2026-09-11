import type {
  SchemaConstraints,
  SchemaLiteral,
  SchemaType,
  TtsProviderSpec,
} from "./spec-model.ts";

export function renderRequestValidator(provider: TtsProviderSpec): string {
  const declarations: string[] = [];
  const validators = new Map<string, string>();
  function declare(body: string): string {
    const key = body;
    const cached = validators.get(key);
    if (cached) return cached;
    const name = `validate${validators.size}`;
    validators.set(key, name);
    declarations.push(
      `function ${name}(value: unknown, path: string, errors: string[]): void {\n${body}\n}`,
    );
    return name;
  }
  function union(
    types: readonly SchemaType[],
    constraints?: SchemaConstraints,
    excluded: readonly string[] = [],
  ): string {
    if (!types.length) return "  errors.push(`${path}: no allowed value`);";
    if (types.length === 1) {
      const type = types[0]!;
      return `  ${compile(type, constraints)}(value, path, errors);`;
    }
    if (types.every((type) => type.kind === "object")) {
      for (const field of types[0]!.fields) {
        if (excluded.includes(field.name)) continue;
        const groups = new Map<SchemaLiteral | undefined, SchemaType[]>();
        for (const type of types) {
          const candidate = type.fields.find((other) => other.name === field.name);
          if (!candidate) break;
          const parts = candidate.type.kind === "union" ? candidate.type.anyOf : [candidate.type];
          if (!parts.length || !parts.every((part) => part.kind === "literal")) break;
          const values: (SchemaLiteral | undefined)[] = parts.map((part) => part.value);
          if (candidate.optional) values.push(undefined);
          for (const value of new Set(values)) {
            const group = groups.get(value) ?? [];
            group.push(type);
            groups.set(value, group);
          }
        }
        const covered = new Set([...groups.values()].flat());
        if (
          covered.size !== types.length ||
          ![...groups.values()].some((group) => group.length < types.length)
        )
          continue;
        const key = JSON.stringify(field.name);
        const expected = [...groups.keys()]
          .map((value) => (value === undefined ? "undefined" : JSON.stringify(value)))
          .join(", ");
        return `  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(path + ": expected object");
    return;
  }
  switch (${key} in value ? value[${key}] : undefined) {
${[...groups]
  .map(
    ([value, group]) => `    case ${value === undefined ? "undefined" : JSON.stringify(value)}: {
${union(group, constraints, [...excluded, field.name])
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
      return;
    }`,
  )
  .join("\n")}
    default: errors.push(path + ${JSON.stringify(`[${key}]: expected one of ${expected}`)});
  }`;
      }
    }
    // Keep failed alternatives in the shared buffer, rolling back when the union succeeds.
    return [
      "  const start = errors.length;",
      "  let before: number;",
      ...types.map(
        (type) => `  before = errors.length;
  ${compile(type, constraints)}(value, path, errors);
  if (errors.length === before) { errors.length = start; return; }`,
      ),
    ].join("\n");
  }
  function compile(type: SchemaType, constraints?: SchemaConstraints): string {
    const lines: string[] = [];
    function check(expression: string, message: string, stop = false) {
      lines.push(
        `  if (!(${expression})) { errors.push(path + ${JSON.stringify(`: ${message}`)});${stop ? " return;" : ""} }`,
      );
    }
    switch (type.kind) {
      case "literal":
        check(
          `value === ${JSON.stringify(type.value)}`,
          `expected ${JSON.stringify(type.value)}`,
          true,
        );
        break;
      case "string":
        check('typeof value === "string"', "expected string", true);
        break;
      case "number":
        check(
          'typeof value === "number" && Number.isFinite(value)',
          "expected finite number",
          true,
        );
        break;
      case "boolean":
        check('typeof value === "boolean"', "expected boolean", true);
        break;
      case "bigint":
        check('typeof value === "bigint"', "expected bigint", true);
        break;
      case "bytes":
        check("value instanceof Uint8Array", "expected Uint8Array", true);
        break;
      case "record":
        check(
          'typeof value === "object" && value !== null && !Array.isArray(value)',
          "expected object",
          true,
        );
        lines.push(
          `  for (const key in value) {`,
          `    if (Object.hasOwn(value, key)) ${compile(type.items)}((value as Record<string, unknown>)[key], path + "[" + JSON.stringify(key) + "]", errors);`,
          `  }`,
        );
        break;
      case "array":
        check("Array.isArray(value)", "expected array", true);
        lines.push(
          `  for (let index = 0; index < value.length; index++) ${compile(type.items)}(value[index], path + "[" + index + "]", errors);`,
        );
        break;
      case "async-iterable":
        check(
          '(typeof value === "object" || typeof value === "function") && value !== null && Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === "function"',
          "expected AsyncIterable",
          true,
        );
        break;
      case "union":
        if (type.anyOf.length && type.anyOf.every((part) => part.kind === "literal")) {
          check(
            type.anyOf.map((part) => `value === ${JSON.stringify(part.value)}`).join(" || "),
            `expected one of ${type.anyOf.map((part) => JSON.stringify(part.value)).join(", ")}`,
            true,
          );
          break;
        }
        return declare(union(type.anyOf, constraints));
      case "object": {
        check(
          'typeof value === "object" && value !== null && !Array.isArray(value)',
          "expected object",
          true,
        );
        for (const field of type.fields) {
          const name = JSON.stringify(field.name);
          const fieldPath = `path + ${JSON.stringify(`[${name}]`)}`;
          const call = `${compile(field.type, field.constraints)}(value[${name}], ${fieldPath}, errors);`;
          lines.push(
            field.optional
              ? `  if (${name} in value && value[${name}] !== undefined) ${call}`
              : `  if (${name} in value) ${call}\n  else errors.push(${fieldPath} + ": required field");`,
          );
        }
        for (const name of type.forbidden ?? []) {
          const key = JSON.stringify(name);
          lines.push(
            `  if (${key} in value && value[${key}] !== undefined) errors.push(path + ${JSON.stringify(`[${key}]: field is not allowed`)});`,
          );
        }
        break;
      }
    }
    if (constraints) {
      if (constraints.minimum !== undefined)
        check(
          `typeof value === "number" && value >= ${constraints.minimum}`,
          `expected number >= ${constraints.minimum}`,
        );
      if (constraints.integer) check("Number.isSafeInteger(value)", "expected safe integer");
      if (constraints.maximum !== undefined)
        check(
          `typeof value === "number" && value <= ${constraints.maximum}`,
          `expected number <= ${constraints.maximum}`,
        );
      if (constraints.pattern !== undefined)
        check(
          `typeof value === "string" && new RegExp(${JSON.stringify(constraints.pattern)}).test(value)`,
          `expected string matching ${constraints.pattern}`,
        );
    }
    return declare(lines.join("\n"));
  }
  const alternatives =
    provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
  const itemGroups = new Map<string, Set<SchemaType>>();
  for (const branch of alternatives) {
    if (branch.kind !== "object") throw new TypeError("Request validators require object variants");
    const text = branch.fields.find((field) => field.name === "text")?.type;
    for (const part of text?.kind === "union" ? text.anyOf : text ? [text] : []) {
      if (part.kind !== "async-iterable") continue;
      const item = compile(part.items);
      const matches = itemGroups.get(item) ?? new Set<SchemaType>();
      matches.add(branch);
      itemGroups.set(item, matches);
    }
  }
  // Item validation assumes the request has already passed validation. Only fields
  // whose checks differ between variants are needed to determine item compatibility.
  const objects = alternatives.map((branch) => {
    if (branch.kind !== "object") throw new TypeError("Request validators require object variants");
    return branch;
  });
  const shared = new Set(
    objects[0]!.fields
      .filter((field) =>
        objects.every((branch) =>
          branch.fields.some(
            (other) =>
              other.name === field.name &&
              other.optional === field.optional &&
              compile(other.type, other.constraints) === compile(field.type, field.constraints),
          ),
        ),
      )
      .map((field) => field.name),
  );
  const selectors: Map<SchemaType, SchemaType> = new Map(
    objects.map((branch) => [
      branch,
      {
        ...branch,
        fields: branch.fields.filter((field) => !shared.has(field.name)),
        forbidden: (branch.forbidden ?? []).filter(
          (name) => !objects.every((other) => other.forbidden?.includes(name)),
        ),
      },
    ]),
  );
  const groups = [...itemGroups].map(([item, matches]) => [
    item,
    declare(union([...matches].map((branch) => selectors.get(branch)!))),
  ]);
  const request = compile(provider.request);
  // Only unconditional, top-level defaults can be resolved before choosing a variant.
  const defaults =
    alternatives[0]?.kind === "object"
      ? alternatives[0].fields.filter(
          (field) =>
            field.default !== undefined &&
            alternatives.every(
              (branch) =>
                branch.kind === "object" &&
                branch.fields.some(
                  (other) => other.name === field.name && other.default === field.default,
                ),
            ),
        )
      : [];
  return `// Generated by codegen/generate-spec.ts from schemas/providers/${provider.id}/index.ts. Do not edit.
${defaults.length ? `/** Defaults shared by every request variant. */\nexport const requestDefaults = ${JSON.stringify(Object.fromEntries(defaults.map((field) => [field.name, field.default])))} as const;\n` : ""}
${declarations.join("\n\n")}

/** Validate the request without consuming or changing its input. */
export function validateRequest(value: unknown): void {
  const errors: string[] = [];
  ${request}(value, "request", errors);
  if (errors.length) throw new TypeError(${JSON.stringify(`Invalid ${provider.id} TTS request`)} + ":\\n" + errors.join("\\n"));
}

/** Validate an item from an already validated request; never consumes or changes the request. */
export function validateInputItem(value: unknown, item: unknown): void {
  const errors: string[] = [];
${groups
  .map(
    ([item, selector]) => `  {
    const before = errors.length;
    ${selector}(value, "request", errors);
    const matches = errors.length === before;
    errors.length = before;
    if (matches) {
      ${item}(item, "text item", errors);
      if (errors.length === before) return;
    }
  }`,
  )
  .join("\n")}
  if (!errors.length) errors.push("text item: streaming input is not supported by this request");
  throw new TypeError(${JSON.stringify(`Invalid ${provider.id} TTS input item`)} + ":\\n" + errors.join("\\n"));
}
`;
}
