import type { SchemaField, SchemaType, TtsProviderSpec } from "./spec-model.ts";

// A union can share a serializer when each source field has the same mapping.
// Missing fields become optional; conflicting mappings require separate contracts.
function fields(type: SchemaType, contract: string): SchemaField[] {
  const variants = type.kind === "union" ? type.anyOf : [type];
  if (!variants.every((variant) => variant.kind === "object")) {
    throw new TypeError(`Cannot serialize mixed object union for ${contract}`);
  }
  const names = new Set(variants.flatMap((variant) => variant.fields.map((field) => field.name)));
  const result: SchemaField[] = [];
  const destinations = new Set<string>();
  for (const name of names) {
    const present = variants.flatMap((variant) =>
      variant.fields.filter((field) => field.name === name),
    );
    const mappings = new Set(present.map((field) => field.serializeAs?.[contract]));
    if (mappings.size !== 1)
      throw new TypeError(`Conflicting @serializeAs ${contract} for ${name}`);
    const destination = present[0]!.serializeAs?.[contract];
    if (destination === undefined) continue;
    if (destinations.has(destination))
      throw new TypeError(`Duplicate @serializeAs ${contract} destination ${destination}`);
    destinations.add(destination);
    const types = [
      ...new Map(present.map((field) => [JSON.stringify(field.type), field.type])).values(),
    ];
    result.push({
      ...present[0]!,
      optional: present.length !== variants.length || present.some((field) => field.optional),
      type: types.length === 1 ? types[0]! : { kind: "union", anyOf: types },
    });
  }
  return result;
}

export function renderRequestSerializer(provider: TtsProviderSpec): string {
  const contracts = new Set<string>();
  function discover(type: SchemaType): void {
    if (type.kind === "object") {
      for (const field of type.fields) {
        for (const contract of Object.keys(field.serializeAs ?? {})) contracts.add(contract);
        discover(field.type);
      }
    } else if (type.kind === "union") {
      type.anyOf.forEach(discover);
    } else if (type.kind === "array" || type.kind === "record" || type.kind === "async-iterable") {
      discover(type.items);
    }
  }
  discover(provider.request);
  const declarations: string[] = [];
  let next = 0;
  type Mapping = { input: string; output: string; expression: (value: string) => string };
  function compile(type: SchemaType, contract: string, name?: string): Mapping {
    if (type.kind === "union") {
      const flatten = (part: SchemaType): SchemaType[] =>
        part.kind === "union" ? part.anyOf.flatMap(flatten) : [part];
      const parts = [
        ...new Map(
          type.anyOf.flatMap(flatten).map((part) => [JSON.stringify(part), part]),
        ).values(),
      ];
      type = parts.length === 1 ? parts[0]! : { kind: "union", anyOf: parts };
    }
    if (
      type.kind === "object" ||
      (type.kind === "union" && type.anyOf.some((part) => part.kind === "object"))
    ) {
      const selected = fields(type, contract);
      const members = selected.map((field) => ({ field, mapping: compile(field.type, contract) }));
      const input = `{ ${members.map(({ field, mapping }) => `readonly ${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ${mapping.input};`).join(" ")} }`;
      const output = `{ ${members.map(({ field, mapping }) => `${JSON.stringify(field.serializeAs![contract])}${field.optional ? "?" : ""}: ${mapping.output};`).join(" ")} }`;
      const functionName = name ?? `serialize${next++}`;
      const lines = name
        ? [
            `export function ${name}(request: TtsRequest): ${output} {`,
            `  const value: ${input} = request;`,
          ]
        : [`function ${functionName}(value: ${input}): ${output} {`];
      // Read each selected property once, preserving omission without repeated spreads.
      for (const [index, { field }] of members.entries())
        lines.push(`  const field${index} = value[${JSON.stringify(field.name)}];`);
      lines.push(`  const result: ${output} = {`);
      for (const [index, { field, mapping }] of members.entries()) {
        if (!field.optional)
          lines.push(
            `    [${JSON.stringify(field.serializeAs![contract])}]: ${mapping.expression(`field${index}`)},`,
          );
      }
      lines.push("  };");
      for (const [index, { field, mapping }] of members.entries()) {
        if (field.optional) {
          const destination = JSON.stringify(field.serializeAs![contract]);
          const assignment =
            field.serializeAs![contract] === "__proto__"
              ? `Object.defineProperty(result, ${destination}, { value: ${mapping.expression(`field${index}`)}, enumerable: true, configurable: true, writable: true })`
              : `result[${destination}] = ${mapping.expression(`field${index}`)}`;
          lines.push(`  if (field${index} !== undefined) ${assignment};`);
        }
      }
      lines.push("  return result;", "}");
      declarations.push(lines.join("\n"));
      return { input, output, expression: (value) => `${functionName}(${value})` };
    }
    if (type.kind === "array" || type.kind === "record") {
      const item = compile(type.items, contract);
      const container = (value: string) =>
        type.kind === "array" ? `ReadonlyArray<${value}>` : `Readonly<Record<string, ${value}>>`;
      return {
        input: container(item.input),
        output: container(item.output),
        expression: (value) =>
          item.expression("item") === "item"
            ? value
            : type.kind === "array"
              ? `${value}.map((item) => ${item.expression("item")})`
              : `Object.fromEntries(Object.entries(${value}).map(([key, item]) => [key, ${item.expression("item")}]))`,
      };
    }
    if (type.kind === "async-iterable")
      throw new TypeError(
        `@serializeAs ${contract} cannot serialize AsyncIterable; handle streaming input in the adapter`,
      );
    const primitive =
      type.kind === "union"
        ? type.anyOf
            .map((part) => {
              const mapping = compile(part, contract);
              if (mapping.expression("value") !== "value")
                throw new TypeError(
                  `Cannot serialize heterogeneous collection union for ${contract}`,
                );
              return mapping.output;
            })
            .join(" | ")
        : type.kind === "literal"
          ? JSON.stringify(type.value)
          : type.kind === "bytes"
            ? "Uint8Array"
            : type.kind;
    return { input: primitive, output: primitive, expression: (value) => value };
  }
  for (const contract of [...contracts].sort()) {
    compile(provider.request, contract, `to${contract[0]!.toUpperCase()}${contract.slice(1)}`);
  }
  return `// Generated by codegen/generate-spec.ts. Do not edit.\nimport type { TtsRequest } from "../../../schemas/providers/${provider.id}/index.ts";\n\n${declarations.join("\n\n")}\n`;
}
