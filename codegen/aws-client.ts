interface AwsShape {
  readonly type: string;
  readonly enum?: readonly string[];
  readonly required?: readonly string[];
  readonly members?: Readonly<Record<string, {
    readonly shape: string;
    readonly location?: string;
    readonly locationName?: string;
    readonly eventpayload?: boolean;
  }>>;
  readonly member?: { readonly shape: string };
  readonly eventstream?: boolean;
  readonly exception?: boolean;
}

interface AwsOperation {
  readonly name: string;
  readonly http: {
    readonly method: string;
    readonly requestUri: string;
  };
  readonly input: { readonly shape: string };
  readonly output?: { readonly shape: string };
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

function referencedShapes(model: AwsServiceModel, roots: readonly string[]): readonly string[] {
  const names = new Set<string>();
  const visit = (name: string): void => {
    if (names.has(name)) return;
    const shape = model.shapes[name];
    invariant(shape, `missing shape ${name}`);
    names.add(name);
    for (const member of Object.values(shape.members ?? {})) visit(member.shape);
    if (shape.member) visit(shape.member.shape);
  };
  for (const root of roots) visit(root);
  return [...names].sort();
}

function renderShape(model: AwsServiceModel, name: string, shape: AwsShape): string {
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
    if (shape.eventstream) {
      const members = Object.entries(shape.members ?? {}).map(([field, member]) =>
        `  | { readonly ${JSON.stringify(field)}: ${typeName(member.shape)} }`
      );
      return `export type ${typeName(name)} =\n${members.join("\n")};`;
    }
    const required = new Set(shape.required ?? []);
    const fields = Object.entries(shape.members ?? {}).map(([field, member]) => {
      const memberShape = model.shapes[member.shape];
      invariant(memberShape, `missing shape ${member.shape}`);
      const type = memberShape.eventstream ? `AsyncIterable<${typeName(member.shape)}>` : typeName(member.shape);
      return `  readonly ${JSON.stringify(field)}${required.has(field) ? "" : "?"}: ${type};`;
    });
    return `${declaration}{\n${fields.join("\n")}\n};`;
  }
  throw new TypeError(`AWS client generation: unsupported ${shape.type} shape ${name}`);
}

function renderEventEncoder(model: AwsServiceModel, streamName: string): string {
  const stream = model.shapes[streamName];
  invariant(stream?.eventstream, `${streamName} must be an event stream`);
  const branches = Object.entries(stream.members ?? {}).map(([eventName, member]) => {
    const event = model.shapes[member.shape];
    invariant(event?.type === "structure", `${member.shape} must be a structure`);
    const payload = Object.entries(event.members ?? {}).find(([, field]) => field.eventpayload);
    const body = payload
      ? `event[${JSON.stringify(eventName)}][${JSON.stringify(payload[0])}]`
      : `encoder.encode(JSON.stringify(event[${JSON.stringify(eventName)}]))`;
    return `    if (${JSON.stringify(eventName)} in event) {\n      yield encodeAwsEventStreamMessage({\n        headers: { ":event-type": ${JSON.stringify(eventName)}, ":message-type": "event", ":content-type": "application/json" },\n        body: ${body},\n      });\n      continue;\n    }`;
  });
  return `async function* encode${streamName}(events: AsyncIterable<${streamName}>): AsyncIterableIterator<Uint8Array> {\n  for await (const event of events) {\n${branches.join("\n")}\n    throw new TypeError("Unknown ${streamName} member");\n  }\n}`;
}

function renderEventDecoder(model: AwsServiceModel, streamName: string): string {
  const stream = model.shapes[streamName];
  invariant(stream?.eventstream, `${streamName} must be an event stream`);
  const branches = Object.entries(stream.members ?? {}).map(([eventName, member]) => {
    const event = model.shapes[member.shape];
    invariant(event?.type === "structure", `${member.shape} must be a structure`);
    const payload = Object.entries(event.members ?? {}).find(([, field]) => field.eventpayload);
    const value = payload
      ? `{ ${JSON.stringify(payload[0])}: message.body }`
      : `JSON.parse(decoder.decode(message.body)) as ${member.shape}`;
    return `      case ${JSON.stringify(eventName)}:\n        yield { ${JSON.stringify(eventName)}: ${value} };\n        break;`;
  });
  return `async function* decode${streamName}(messages: AsyncIterable<AwsEventStreamMessage>): AsyncIterableIterator<${streamName}> {\n  for await (const message of messages) {\n    const messageType = message.headers[":message-type"];\n    const eventType = messageType === "exception" ? message.headers[":exception-type"] : message.headers[":event-type"];\n    if (messageType === "error") {\n      const detail = message.headers[":error-message"];\n      throw new TypeError(typeof detail === "string" ? detail : "AWS event stream error");\n    }\n    switch (eventType) {\n${branches.join("\n")}\n      default:\n        throw new TypeError(\`Unknown ${streamName} member \${String(eventType)}\`);\n    }\n  }\n}`;
}

function renderStreamingOperation(model: AwsServiceModel, operation: AwsOperation): string {
  invariant(operation.output, `${operation.name} has no output`);
  const input = model.shapes[operation.input.shape];
  const output = model.shapes[operation.output.shape];
  invariant(input?.type === "structure" && output?.type === "structure", `${operation.name} input and output must be structures`);
  const inputStream = Object.entries(input.members ?? {}).find(([, member]) => model.shapes[member.shape]?.eventstream);
  const outputStream = Object.entries(output.members ?? {}).find(([, member]) => model.shapes[member.shape]?.eventstream);
  invariant(inputStream && outputStream, `${operation.name} must have input and output event streams`);
  const required = new Set(input.required ?? []);
  const headers = Object.entries(input.members ?? {}).filter(([, member]) => member.location === "header").map(([field, member]) => {
    invariant(member.locationName, `${operation.name}.${field} header has no locationName`);
    const list = model.shapes[member.shape]?.type === "list";
    const value = list ? `input.${field}.join(", ")` : `String(input.${field})`;
    return required.has(field)
      ? `      ${JSON.stringify(member.locationName.toLowerCase())}: ${value},`
      : `      ...(input.${field} !== undefined ? { ${JSON.stringify(member.locationName.toLowerCase())}: ${value} } : {}),`;
  });
  return `${renderEventEncoder(model, inputStream[1].shape)}\n\n${renderEventDecoder(model, outputStream[1].shape)}\n\nexport interface EventStreamClientOptions {\n  readonly baseUrl: string;\n  readonly eventStream: AwsEventStreamClient;\n  readonly signal: AbortSignal | undefined;\n}\n\nexport async function ${functionName(operation.name)}(input: ${operation.input.shape}, options: EventStreamClientOptions): Promise<${operation.output.shape}> {\n  if (!input.${inputStream[0]}) throw new TypeError(${JSON.stringify(`${operation.name}.${inputStream[0]} is required`)});\n  const messages = await options.eventStream.request(\n    ${JSON.stringify(operation.http.method)},\n    new URL(${JSON.stringify(operation.http.requestUri)}, options.baseUrl),\n    {\n${headers.join("\n")}\n    },\n    encode${inputStream[1].shape}(input.${inputStream[0]}),\n    options.signal,\n  );\n  return { ${outputStream[0]}: decode${outputStream[1].shape}(messages) };\n}`;
}

function functionName(name: string): string {
  return `${name[0]?.toLowerCase() ?? ""}${name.slice(1)}`;
}

export function renderAwsClient(model: AwsServiceModel, operationNames: readonly string[], source: string): string {
  const operations = operationNames.map((name) => {
    const operation = model.operations[name];
    invariant(operation, `missing operation ${name}`);
    return operation;
  });
  const roots = operations.flatMap((operation) => [operation.input.shape, ...(operation.output ? [operation.output.shape] : [])]);
  const types = referencedShapes(model, roots).map((name) => renderShape(model, name, model.shapes[name]!));
  const ordinary = operations.filter(({ input }) => !Object.values(model.shapes[input.shape]?.members ?? {}).some((member) => model.shapes[member.shape]?.eventstream));
  const streaming = operations.filter(({ input }) => Object.values(model.shapes[input.shape]?.members ?? {}).some((member) => model.shapes[member.shape]?.eventstream));
  const functions = ordinary.map((operation) => `export function ${functionName(operation.name)}(input: ${operation.input.shape}, options: ClientOptions): Promise<Response> {\n  return options.fetch(new URL(${JSON.stringify(operation.http.requestUri)}, options.baseUrl), {\n    method: ${JSON.stringify(operation.http.method)},\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify(input),\n    signal: options.signal,\n  });\n}`).concat(streaming.map((operation) => renderStreamingOperation(model, operation)));
  return `// Generated from ${source}. Do not edit.\n\nimport type { Fetch } from "../../runtime/fetch.ts";\nimport { encodeAwsEventStreamMessage, type AwsEventStreamClient, type AwsEventStreamMessage } from "../../runtime/aws/event-stream.ts";\n\nconst encoder = new TextEncoder();\nconst decoder = new TextDecoder();\n\n${types.join("\n\n")}\n\nexport interface ClientOptions {\n  readonly baseUrl: string;\n  readonly fetch: Fetch;\n  readonly signal: AbortSignal | null;\n}\n\n${functions.join("\n\n")}\n`;
}
