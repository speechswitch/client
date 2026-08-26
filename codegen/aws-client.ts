interface AwsShape {
  readonly type: string;
  readonly enum?: readonly string[];
  readonly required?: readonly string[];
  readonly members?: Readonly<Record<string, { readonly shape: string }>>;
  readonly member?: { readonly shape: string };
}

interface AwsOperation {
  readonly name: string;
  readonly http: {
    readonly method: string;
    readonly requestUri: string;
  };
  readonly input: { readonly shape: string };
}

export interface AwsServiceModel {
  readonly operations: Readonly<Record<string, AwsOperation>>;
  readonly shapes: Readonly<Record<string, AwsShape>>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(`AWS client generation: ${message}`);
}

function typeName(name: string): string {
  invariant(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name), `invalid shape name ${name}`);
  return name;
}

function referencedShapes(model: AwsServiceModel, root: string): readonly string[] {
  const names = new Set<string>();
  const visit = (name: string): void => {
    if (names.has(name)) return;
    const shape = model.shapes[name];
    invariant(shape, `missing shape ${name}`);
    names.add(name);
    for (const member of Object.values(shape.members ?? {})) visit(member.shape);
    if (shape.member) visit(shape.member.shape);
  };
  visit(root);
  return [...names].sort();
}

function renderShape(name: string, shape: AwsShape): string {
  const declaration = `export type ${typeName(name)} = `;
  if (shape.enum) return `${declaration}${shape.enum.map((value) => JSON.stringify(value)).join(" | ")};`;
  if (shape.type === "string") return `${declaration}string;`;
  if (shape.type === "blob") return `${declaration}Uint8Array;`;
  if (shape.type === "boolean") return `${declaration}boolean;`;
  if (["integer", "long", "float", "double"].includes(shape.type)) return `${declaration}number;`;
  if (shape.type === "list") {
    invariant(shape.member, `list ${name} has no member shape`);
    return `${declaration}readonly ${typeName(shape.member.shape)}[];`;
  }
  if (shape.type === "structure") {
    const required = new Set(shape.required ?? []);
    const fields = Object.entries(shape.members ?? {}).map(([field, member]) =>
      `  readonly ${JSON.stringify(field)}${required.has(field) ? "" : "?"}: ${typeName(member.shape)};`
    );
    return `${declaration}{\n${fields.join("\n")}\n};`;
  }
  throw new TypeError(`AWS client generation: unsupported ${shape.type} shape ${name}`);
}

function functionName(name: string): string {
  return `${name[0]?.toLowerCase() ?? ""}${name.slice(1)}`;
}

export function renderAwsClient(model: AwsServiceModel, operationName: string, source: string): string {
  const operation = model.operations[operationName];
  invariant(operation, `missing operation ${operationName}`);
  const input = operation.input.shape;
  const types = referencedShapes(model, input).map((name) => renderShape(name, model.shapes[name]!));
  return `// Generated from ${source}. Do not edit.\n\nimport type { Fetch } from "../../sdk/fetch.ts";\n\n${types.join("\n\n")}\n\nexport interface ClientOptions {\n  readonly baseUrl: string;\n  readonly fetch: Fetch;\n  readonly signal: AbortSignal | null;\n}\n\nexport function ${functionName(operation.name)}(input: ${typeName(input)}, options: ClientOptions): Promise<Response> {\n  return options.fetch(new URL(${JSON.stringify(operation.http.requestUri)}, options.baseUrl), {\n    method: ${JSON.stringify(operation.http.method)},\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify(input),\n    signal: options.signal,\n  });\n}\n`;
}
