type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a structured CAMB contract object");
  return value as ObjectValue;
}

function resolve(document: unknown, value: unknown, seen = new Set<string>()): ObjectValue {
  const schema = object(value);
  if (schema.$ref === undefined) return schema;
  if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) throw new TypeError("Only local CAMB schema references are supported");
  if (seen.has(schema.$ref)) throw new TypeError(`Recursive CAMB reference: ${schema.$ref}`);
  seen.add(schema.$ref);
  const target = schema.$ref.slice(2).split("/").reduce((current: unknown, key) => object(current)[key.replace(/~1/g, "/").replace(/~0/g, "~")], document);
  const { $ref, ...siblings } = schema;
  if (Object.keys(siblings).some(key => !["description", "title", "default", "example", "examples"].includes(key))) {
    throw new TypeError(`Unsupported constraints alongside ${$ref}`);
  }
  return resolve(document, target, seen);
}

// Compile the selected schema graph into ordinary TS types and direct predicates.
// Unsupported validation keywords fail generation instead of being silently erased.
function compile(document: unknown, value: unknown, expression: string, depth = 0): { type: string; check: string } {
  if (depth > 50) throw new TypeError("CAMB schema graph is too deep or recursive");
  const schema = resolve(document, value);
  const supported = ["type", "properties", "required", "items", "enum", "const", "anyOf", "nullable", "format", "minimum", "maximum", "minLength", "maxLength", "additionalProperties", "title", "description", "default", "example", "examples", "deprecated"];
  const unsupported = Object.keys(schema).find(key => !supported.includes(key));
  if (unsupported) throw new TypeError(`Unsupported CAMB schema keyword: ${unsupported}`);
  let type: string;
  let check: string;
  if (Array.isArray(schema.anyOf)) {
    if (Object.keys(schema).some(key => ["type", "properties", "items", "enum", "const"].includes(key))) throw new TypeError("Unsupported constraints alongside anyOf");
    const parts = schema.anyOf.map(part => compile(document, part, expression, depth + 1));
    if (!parts.length) throw new TypeError("Empty CAMB anyOf");
    type = parts.map(part => part.type).join(" | ");
    check = `(${parts.map(part => part.check).join(" || ")})`;
  } else if (schema.type === "object") {
    const properties = schema.properties === undefined ? {} : object(schema.properties);
    const required = schema.required === undefined ? [] : schema.required;
    if (!Array.isArray(required) || !required.every(key => typeof key === "string" && key in properties)) throw new TypeError("Invalid CAMB required properties");
    const fields: string[] = [];
    const checks = [`typeof ${expression} === "object"`, `${expression} !== null`, `!Array.isArray(${expression})`];
    for (const [key, child] of Object.entries(properties)) {
      const property = JSON.stringify(key);
      const part = compile(document, child, `${expression}[${property}]`, depth + 1);
      const presence = `${property} in ${expression}`;
      fields.push(`readonly ${property}${required.includes(key) ? "" : "?"}: ${part.type};`);
      checks.push(required.includes(key) ? `(${presence} && ${part.check})` : `(!(${presence}) || ${expression}[${property}] === undefined || ${part.check})`);
    }
    if (schema.additionalProperties === false) {
      checks.push(`Object.keys(${expression}).every(key => ${JSON.stringify(Object.keys(properties))}.includes(key))`);
    } else if (schema.additionalProperties === undefined || schema.additionalProperties === true) {
      fields.push("readonly [key: string]: unknown;");
    } else throw new TypeError("Typed additionalProperties are not supported in the selected CAMB protocol");
    type = `{ ${fields.join(" ")} }`;
    check = `(${checks.join(" && ")})`;
  } else if (schema.type === "array") {
    const item = `item${depth}`;
    const part = compile(document, schema.items, item, depth + 1);
    type = `readonly (${part.type})[]`;
    check = `(Array.isArray(${expression}) && ${expression}.every((${item}: unknown) => ${part.check}))`;
  } else if (schema.type === "string" && schema.format === "binary") {
    type = "Uint8Array";
    check = `${expression} instanceof Uint8Array`;
  } else if (schema.type === "string" || schema.type === "boolean" || schema.type === "number" || schema.type === "integer") {
    type = schema.type === "integer" ? "number" : schema.type;
    const checks = [`typeof ${expression} === ${JSON.stringify(type)}`];
    if (type === "number") checks.push(`Number.${schema.type === "integer" ? "isInteger" : "isFinite"}(${expression})`);
    if (schema.format !== undefined && !["float", "double", "int32", "int64"].includes(String(schema.format))) throw new TypeError(`Unsupported CAMB format: ${schema.format}`);
    for (const [keyword, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
      if (schema[keyword] !== undefined) {
        if (typeof schema[keyword] !== "number") throw new TypeError(`Invalid CAMB ${keyword}`);
        const length = keyword.endsWith("Length");
        if ((length && type !== "string") || (!length && type !== "number")) throw new TypeError(`Unsupported ${keyword} on ${type}`);
        checks.push(`${length ? `Array.from(${expression}).length` : expression} ${operator} ${schema[keyword]}`);
      }
    }
    check = `(${checks.join(" && ")})`;
  } else if (schema.type === "null") { type = "null"; check = `${expression} === null`; }
  else throw new TypeError(`Unsupported CAMB schema type: ${String(schema.type)}`);

  if (schema.enum !== undefined || "const" in schema) {
    const values = "const" in schema ? [schema.const] : schema.enum;
    if (!Array.isArray(values) || !values.length || !values.every(item => item === null || ["string", "number", "boolean"].includes(typeof item))) throw new TypeError("Invalid CAMB literal schema");
    type = values.map(item => JSON.stringify(item)).join(" | ");
    check = `(${check} && (${values.map(item => `${expression} === ${JSON.stringify(item)}`).join(" || ")}))`;
  }
  if (schema.nullable === true) { type = `${type} | null`; check = `(${expression} === null || ${check})`; }
  else if (schema.nullable !== undefined && schema.nullable !== false) throw new TypeError("Invalid CAMB nullable flag");
  return { type, check };
}

export function renderCambClient(openapi: unknown, asyncapi: unknown, urls: readonly string[]) {
  const http = object(openapi);
  const live = object(asyncapi);
  if (http.openapi !== "3.1.0" || live.asyncapi !== "3.0.0") throw new TypeError("Unsupported CAMB contract version");
  const operations = Object.entries(object(http.paths)).flatMap(([path, methods]) => Object.entries(object(methods)).map(([method, value]) => ({ path, method, operation: object(value) })));
  const selected = operations.filter(({ operation }) => operation.operationId === "tts_tts_stream_post");
  if (selected.length !== 1) throw new TypeError("Expected one CAMB streaming HTTP operation");
  const { path, method, operation } = selected[0]!;
  const requestBody = object(operation.requestBody);
  if (requestBody.required !== true || method !== "post" || operation.parameters !== undefined) throw new TypeError("Unsupported CAMB HTTP operation shape");
  const inputSchema = object(object(requestBody.content)["application/json"]).schema;
  const input = compile(http, inputSchema, "value");
  const response = object(object(operation.responses)["200"]);
  const content = Object.values(object(response.content));
  if (!content.length || content.some(value => {
    const schema = resolve(http, object(value).schema);
    return schema.type !== "string" || schema.format !== "binary";
  })) throw new TypeError("CAMB response is not a binary audio stream");
  const security = operation.security;
  if (!Array.isArray(security) || security.length !== 1 || Object.keys(object(security[0])).length !== 1) throw new TypeError("Unsupported CAMB HTTP security requirements");
  const schemeName = Object.keys(object(security[0]))[0]!;
  const scheme = object(object(object(http.components).securitySchemes)[schemeName]);
  if (scheme.type !== "apiKey" || scheme.in !== "header" || typeof scheme.name !== "string") throw new TypeError("Unsupported CAMB HTTP authentication");
  if (!Array.isArray(http.servers) || http.servers.length !== 1) throw new TypeError("Expected one CAMB HTTP server");
  const baseUrl = object(http.servers[0]).url;
  if (typeof baseUrl !== "string" || !URL.canParse(baseUrl)) throw new TypeError("Invalid CAMB HTTP server");

  const servers = Object.values(object(live.servers));
  if (servers.length !== 1) throw new TypeError("Expected one CAMB live server");
  const server = object(servers[0]);
  if (server.protocol !== "wss" || typeof server.host !== "string" || typeof server.pathname !== "string" || server.bindings !== undefined) throw new TypeError("Unsupported CAMB WebSocket server");
  const declarations: string[] = [];
  const visited = new Map<string, { type: string; check: string }>();
  const definitions = new Map<string, unknown>();
  const groups: string[][] = [];
  for (const action of ["send", "receive"]) {
    const matches = Object.values(object(live.operations)).map(object).filter(operation => operation.action === action);
    if (matches.length !== 1) throw new TypeError(`Expected one CAMB ${action} operation`);
    const operation = matches[0]!;
    const channel = resolve(live, operation.channel);
    if (channel.address !== server.pathname || channel.parameters !== undefined || channel.bindings !== undefined || operation.bindings !== undefined) throw new TypeError("Unsupported CAMB channel configuration");
    if (!Array.isArray(operation.messages) || !operation.messages.length) throw new TypeError("CAMB operation lacks messages");
    const names: string[] = [];
    for (const reference of operation.messages) {
      const message = resolve(live, reference);
      if (typeof message.name !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(message.name) || message.bindings !== undefined) throw new TypeError("Invalid CAMB message definition");
      const part = compile(live, message.payload, "value");
      const payload = resolve(live, message.payload);
      if (message.contentType !== (payload.type === "string" && payload.format === "binary" ? "application/octet-stream" : "application/json")) throw new TypeError("Unsupported CAMB message content type");
      if (!visited.has(message.name)) {
        visited.set(message.name, part);
        definitions.set(message.name, message.payload);
        declarations.push(`export type ${message.name} = ${part.type};`);
      } else if (definitions.get(message.name) !== message.payload) throw new TypeError("Conflicting CAMB message definitions");
      names.push(message.name);
    }
    groups.push(names);
  }
  const languageSchema = object(resolve(http, inputSchema).properties).language;
  const language = compile(http, languageSchema, "value");
  return {
    languages: `// Generated by codegen/generate-clients.ts from ${urls[0]}. Do not edit.\nexport type Language = ${language.type};\n`,
    client: `// Generated by codegen/generate-clients.ts from ${urls.join(" and ")}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";
export const defaultBaseUrl = ${JSON.stringify(baseUrl)};
export const defaultWebSocketUrl = ${JSON.stringify(`${server.protocol}://${server.host}${server.pathname}`)};
export type HttpInput = ${input.type};
${declarations.join("\n")}
export type ClientMessage = ${groups[0]!.join(" | ")};
export type ServerMessage = ${groups[1]!.join(" | ")};
export interface ClientOptions { readonly apiKey: string; readonly baseUrl: string; readonly fetch: Fetch; readonly signal: AbortSignal }
export function streamSpeech(value: HttpInput, options: ClientOptions): Promise<Response> {
  if (!(${input.check})) throw new TypeError("Invalid CAMB HTTP synthesis request");
  return options.fetch(options.baseUrl.replace(/\\/$/, "") + ${JSON.stringify(path)}, {
    method: ${JSON.stringify(method.toUpperCase())},
    headers: { ${JSON.stringify(scheme.name)}: options.apiKey, "content-type": "application/json" },
    body: JSON.stringify(value), signal: options.signal,
  });
}
export function encodeMessage(message: ClientMessage): string { return JSON.stringify(message); }
export function decodeMessage(data: unknown): ServerMessage {
  const value: unknown = typeof data === "string" ? JSON.parse(data)
    : data instanceof ArrayBuffer ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data;
  if (!(${groups[1]!.map(name => visited.get(name)!.check).join(" || ")})) throw new TypeError("Invalid CAMB WebSocket message");
  return value as ServerMessage;
}
`,
  };
}
