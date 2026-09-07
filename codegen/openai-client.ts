import { renderOpenaiPythonClient } from "./openai-python-client.ts";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected an OpenAI contract object");
  return value as ObjectValue;
}

/** Compile the selected speech graph; unsupported semantics fail instead of being erased. */
export function renderOpenaiClient(raw: unknown, sourceUrl: string): string {
  return renderOpenaiClients(raw, sourceUrl).typescript;
}

export function renderOpenaiClients(raw: unknown, sourceUrl: string): { typescript: string; python: string } {
  const document = object(raw);
  if (document.openapi !== "3.1.0") throw new TypeError("Unsupported OpenAI OpenAPI version");
  function compile(raw: unknown, value: string, seen: readonly string[] = []): { type: string; check: string } {
    const schema = object(raw);
    if (schema.$ref !== undefined) {
      if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/components/schemas/")) throw new TypeError("Unsupported OpenAI schema reference");
      if (seen.includes(schema.$ref)) throw new TypeError("Recursive OpenAI schema reference");
      if (Object.keys(schema).some(key => !["$ref", "description", "title", "default"].includes(key))) throw new TypeError("Unsupported OpenAI reference siblings");
      const target = schema.$ref.slice(2).split("/").reduce((node: unknown, key) => object(node)[key.replace(/~1/g, "/").replace(/~0/g, "~")], document);
      if (target === undefined) throw new TypeError(`Unresolved OpenAI reference: ${schema.$ref}`);
      return compile(target, value, [...seen, schema.$ref]);
    }
    const allowed = ["type", "properties", "required", "additionalProperties", "anyOf", "enum", "minimum", "maximum", "maxLength", "minLength", "description", "title", "default", "example", "examples", "discriminator"];
    const unknown = Object.keys(schema).find(key => !allowed.includes(key) && !key.startsWith("x-"));
    if (unknown) throw new TypeError(`Unsupported OpenAI schema keyword: ${unknown}`);
    if (schema.discriminator !== undefined) {
      const discriminator = object(schema.discriminator);
      if (Object.keys(discriminator).some(key => key !== "propertyName") || typeof discriminator.propertyName !== "string") throw new TypeError("Unsupported OpenAI discriminator");
    }
    if (schema.anyOf !== undefined && !Array.isArray(schema.anyOf)) throw new TypeError("Invalid OpenAI anyOf");
    if (Array.isArray(schema.anyOf)) {
      if (!schema.anyOf.length || Object.keys(schema).some(key => ["type", "properties", "required", "enum", "minimum", "maximum", "minLength", "maxLength", "additionalProperties"].includes(key))) throw new TypeError("Unsupported OpenAI anyOf constraints");
      const parts = schema.anyOf.map(part => compile(part, value, seen));
      return { type: parts.map(part => part.type).join(" | "), check: `(${parts.map(part => part.check).join(" || ")})` };
    }
    let type: string; const checks: string[] = [];
    if (schema.type === "object") {
      const properties = object(schema.properties); const required = schema.required ?? [];
      if (!Array.isArray(required) || !required.every(key => typeof key === "string" && Object.hasOwn(properties, key))) throw new TypeError("Invalid OpenAI required fields");
      const fields: string[] = []; checks.push(`typeof ${value} === "object"`, `${value} !== null`, `!Array.isArray(${value})`);
      for (const [key, child] of Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))) {
        const name = JSON.stringify(key); const part = compile(child, `${value}[${name}]`, seen);
        fields.push(`readonly ${name}${required.includes(key) ? "" : "?"}: ${part.type};`);
        checks.push(required.includes(key) ? `(${name} in ${value} && ${part.check})` : `(!(${name} in ${value}) || ${value}[${name}] === undefined || ${part.check})`);
      }
      if (schema.additionalProperties === false) checks.push(`Object.keys(${value}).every(key => ${JSON.stringify(Object.keys(properties).sort())}.includes(key))`);
      else if (schema.additionalProperties === undefined || schema.additionalProperties === true) fields.push("readonly [key: string]: unknown;");
      else throw new TypeError("Unsupported OpenAI additionalProperties");
      type = `{ ${fields.join(" ")} }`;
    } else if (["string", "number", "integer", "boolean"].includes(String(schema.type))) {
      if (["properties", "required", "additionalProperties"].some(key => schema[key] !== undefined)) throw new TypeError("Unsupported OpenAI scalar object constraints");
      type = schema.type === "integer" ? "number" : String(schema.type); checks.push(`typeof ${value} === ${JSON.stringify(type)}`);
      if (type === "number") checks.push(`Number.${schema.type === "integer" ? "isSafeInteger" : "isFinite"}(${value})`);
    } else throw new TypeError(`Unsupported OpenAI schema type: ${String(schema.type)}`);
    for (const [key, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
      const bound = schema[key]; if (bound === undefined) continue;
      const length = key.endsWith("Length");
      if (typeof bound !== "number" || !Number.isFinite(bound) || (length ? type !== "string" || !Number.isSafeInteger(bound) || bound < 0 : type !== "number")) throw new TypeError(`Invalid OpenAI ${key}`);
      checks.push(`${length ? `Array.from(${value}).length` : value} ${operator} ${bound}`);
    }
    if (schema.enum !== undefined) {
      if (!Array.isArray(schema.enum) || !schema.enum.length || !schema.enum.every(item => typeof item === type && (typeof item !== "number" || Number.isFinite(item)))) throw new TypeError("Invalid OpenAI enum");
      type = schema.enum.map(item => JSON.stringify(item)).join(" | "); checks.push(`(${schema.enum.map(item => `${value} === ${JSON.stringify(item)}`).join(" || ")})`);
    }
    return { type, check: `(${checks.join(" && ")})` };
  }
  const matches = Object.entries(object(document.paths)).flatMap(([path, item]) => Object.entries(object(item)).filter(([method]) => ["get", "post", "put", "delete", "patch"].includes(method)).map(([method, operation]) => ({ path, method, operation: object(operation), item: object(item) }))).filter(item => item.operation.operationId === "createSpeech");
  if (matches.length !== 1) throw new TypeError("Expected one OpenAI createSpeech operation");
  const { path, method, operation, item } = matches[0]!;
  if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || method !== "post" || operation.parameters !== undefined || operation.servers !== undefined || item.parameters !== undefined || item.servers !== undefined || item.$ref !== undefined || operation.callbacks !== undefined) throw new TypeError("Unsupported OpenAI speech transport");
  const security = operation.security ?? document.security;
  if (!Array.isArray(security) || security.length !== 1 || Object.keys(object(security[0])).length !== 1) throw new TypeError("Unsupported OpenAI security");
  const [schemeName, scopes] = Object.entries(object(security[0]))[0]!;
  const scheme = object(object(object(document.components).securitySchemes)[schemeName]);
  if (scheme.type !== "http" || scheme.scheme !== "bearer" || !Array.isArray(scopes) || scopes.length) throw new TypeError("Unsupported OpenAI authentication");
  if (!Array.isArray(document.servers) || document.servers.length !== 1) throw new TypeError("Expected one OpenAI server");
  const serverEntry = object(document.servers[0]);
  if (serverEntry.variables !== undefined) throw new TypeError("Unsupported OpenAI server variables");
  const server = serverEntry.url;
  if (typeof server !== "string" || !URL.canParse(server) || new URL(server).protocol !== "https:") throw new TypeError("Invalid OpenAI server URL");
  const body = object(operation.requestBody); const content = object(body.content);
  if (body.required !== true || Object.keys(content).join() !== "application/json") throw new TypeError("Unsupported OpenAI speech request body");
  const input = compile(object(content["application/json"]).schema, "value");
  const responses = object(operation.responses); const statuses = Object.keys(responses).filter(status => /^2\d\d$/.test(status));
  if (statuses.length !== 1) throw new TypeError("Expected one OpenAI speech success status");
  const responseContent = object(object(responses[statuses[0]!]).content);
  if (Object.keys(responseContent).sort().join() !== "application/octet-stream,text/event-stream") throw new TypeError("Unsupported OpenAI speech response media");
  const binary = object(object(responseContent["application/octet-stream"]).schema);
  if (binary.type !== "string" || binary.format !== "binary" || Object.keys(binary).some(key => !["type", "format", "description", "title"].includes(key) && !key.startsWith("x-"))) throw new TypeError("Expected OpenAI binary audio response");
  const event = compile(object(responseContent["text/event-stream"]).schema, "value");
  const typescript = `// Generated from ${sourceUrl}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";
export const defaultBaseUrl = ${JSON.stringify(server)};
export const speechStatus = ${statuses[0]};
export type SpeechRequest = ${input.type};
export type SpeechEvent = ${event.type};
export interface SpeechOptions { readonly apiKey: string; readonly baseUrl: string; readonly fetch: Fetch; readonly signal: AbortSignal }
export function createSpeech(value: SpeechRequest, options: SpeechOptions): Promise<Response> {
  if (!${input.check}) throw new TypeError("Invalid OpenAI speech wire request");
  const url = new URL(options.baseUrl); url.pathname = url.pathname.replace(/\\/$/, "") + ${JSON.stringify(path)};
  return options.fetch(url, { method: ${JSON.stringify(method.toUpperCase())}, headers: { Authorization: \`Bearer \${options.apiKey}\`, "Content-Type": "application/json", Accept: "application/octet-stream, text/event-stream" }, body: JSON.stringify(value), signal: options.signal, redirect: "error" });
}
export function decodeSpeechEvent(value: unknown): SpeechEvent {
  if (!${event.check}) throw new TypeError("Invalid OpenAI speech event");
  return value as SpeechEvent;
}
`;
  return { typescript, python: renderOpenaiPythonClient({ document, sourceUrl, baseUrl: server, path, method,
    status: Number(statuses[0]), input: object(content["application/json"]).schema,
    event: object(responseContent["text/event-stream"]).schema }) };
}
