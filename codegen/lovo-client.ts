import type { LovoContract } from "./lovo-contract.ts";
import { renderLovoPythonClient } from "./lovo-python-client.ts";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a LOVO contract object");
  return value as ObjectValue;
}

/** Compile only the selected JSON TTS graph, never a runtime schema interpreter. */
export function renderLovoClient(raw: unknown, sourceUrl: string): string {
  return renderLovoClients(raw, sourceUrl).typescript;
}

export function renderLovoClients(raw: unknown, sourceUrl: string): { typescript: string; python: string } {
  const document = object(raw);
  if (document.openapi !== "3.0.0") throw new TypeError("Unsupported LOVO OpenAPI version");
  const components = object(document.components); const schemas = object(components.schemas);
  const definitions = new Map<string, { type: string; check: string }>(); const visiting = new Set<string>();
  const compile = (raw: unknown, value: string, depth = 0): { type: string; check: string } => {
    if (depth > 50) throw new TypeError("LOVO schema graph is too deep");
    const schema = object(raw);
    if (schema.$ref !== undefined) {
      if (typeof schema.$ref !== "string" || !/^#\/components\/schemas\/[A-Za-z][A-Za-z0-9]*$/.test(schema.$ref)) throw new TypeError("Unsupported LOVO reference");
      if (Object.keys(schema).some(key => !["$ref", "description", "title"].includes(key))) throw new TypeError("Unsupported LOVO reference siblings");
      const name = schema.$ref.split("/").at(-1)!;
      if (!Object.hasOwn(schemas, name)) throw new TypeError(`Unresolved LOVO reference: ${name}`);
      if (visiting.has(name)) throw new TypeError(`Recursive LOVO reference: ${name}`);
      if (!definitions.has(name)) { visiting.add(name); definitions.set(name, compile(schemas[name], "value", depth + 1)); visiting.delete(name); }
      return { type: name, check: `valid${name}(${value})` };
    }
    const supported = ["type", "properties", "required", "items", "enum", "nullable", "minimum", "maximum", "minLength", "maxLength", "additionalProperties", "format", "title", "description", "default", "example", "examples"];
    const unsupported = Object.keys(schema).find(key => !supported.includes(key));
    if (unsupported) throw new TypeError(`Unsupported LOVO schema keyword: ${unsupported}`);
    let type: string; let checks: string[];
    if (schema.type === "object") {
      const properties = object(schema.properties); const required = schema.required ?? [];
      if (!Array.isArray(required) || !required.every(key => typeof key === "string" && Object.hasOwn(properties, key))) throw new TypeError("Invalid LOVO required properties");
      const fields: string[] = []; checks = [`typeof ${value} === "object"`, `${value} !== null`, `!Array.isArray(${value})`];
      for (const [key, child] of Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))) {
        const property = JSON.stringify(key); const item = compile(child, `${value}[${property}]`, depth + 1);
        fields.push(`readonly ${property}${required.includes(key) ? "" : "?"}: ${item.type};`);
        checks.push(required.includes(key) ? `(${property} in ${value} && ${item.check})` : `(!(${property} in ${value}) || ${value}[${property}] === undefined || ${item.check})`);
      }
      if (schema.additionalProperties === false) checks.push(`Object.keys(${value}).every(key => ${JSON.stringify(Object.keys(properties).sort())}.includes(key))`);
      else if (schema.additionalProperties === undefined || schema.additionalProperties === true) fields.push("readonly [key: string]: unknown;");
      else throw new TypeError("Unsupported LOVO additionalProperties");
      type = `{ ${fields.join(" ")} }`;
    } else if (schema.type === "array") {
      const item = compile(schema.items, `item${depth}`, depth + 1); type = `readonly (${item.type})[]`;
      checks = [`Array.isArray(${value})`, `${value}.every((item${depth}: unknown) => ${item.check})`];
    } else if (["string", "number", "integer", "boolean"].includes(String(schema.type))) {
      type = schema.type === "integer" ? "number" : String(schema.type); checks = [`typeof ${value} === ${JSON.stringify(type)}`];
      if (type === "number") checks.push(`Number.${schema.type === "integer" ? "isSafeInteger" : "isFinite"}(${value})`);
      // These formats annotate opaque strings, not alternative wire encodings.
      if (schema.format !== undefined && (type !== "string" || !["date-time", "mongoid"].includes(String(schema.format)))) throw new TypeError(`Unsupported LOVO schema format: ${schema.format}`);
    } else throw new TypeError(`Unsupported LOVO schema type: ${String(schema.type)}`);
    for (const [keyword, operator] of [["minimum", ">="], ["maximum", "<="], ["minLength", ">="], ["maxLength", "<="]] as const) {
      if (schema[keyword] === undefined) continue;
      const length = keyword.endsWith("Length");
      if (typeof schema[keyword] !== "number" || !Number.isFinite(schema[keyword]) || (length ? type !== "string" : type !== "number")) throw new TypeError(`Invalid LOVO ${keyword}`);
      checks.push(`${length ? `Array.from(${value}).length` : value} ${operator} ${schema[keyword]}`);
    }
    if (schema.enum !== undefined) {
      if (!Array.isArray(schema.enum) || !schema.enum.length || !schema.enum.every(item => typeof item === type && (typeof item !== "number" || Number.isFinite(item)))) throw new TypeError("Invalid LOVO enum");
      type = schema.enum.map(item => JSON.stringify(item)).join(" | "); checks.push(`(${schema.enum.map(item => `${value} === ${JSON.stringify(item)}`).join(" || ")})`);
    }
    let check = `(${checks.join(" && ")})`;
    if (schema.nullable === true) { type = `${type} | null`; check = `(${value} === null || ${check})`; }
    else if (schema.nullable !== undefined && schema.nullable !== false) throw new TypeError("Invalid LOVO nullable flag");
    return { type, check };
  };
  if (!Array.isArray(document.servers) || document.servers.length !== 1) throw new TypeError("Expected one LOVO server");
  const server = object(document.servers[0]).url;
  if (typeof server !== "string" || !URL.canParse(server) || new URL(server).protocol !== "https:") throw new TypeError("Invalid LOVO server URL");
  const available = Object.entries(object(document.paths)).flatMap(([path, raw]) => Object.entries(object(raw))
    .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method)).map(([method, raw]) => ({ path, method, operation: object(raw) })));
  const methods: string[] = [];
  const operations: LovoContract["operations"][number][] = [];
  for (const [id, name] of [["sync-tts", "createSpeech"], ["async-tts", "createSpeechJob"], ["async-retrieve-job", "getSpeechJob"]] as const) {
    const matches = available.filter(value => value.operation.operationId === id);
    if (matches.length !== 1) throw new TypeError(`Expected one LOVO operation: ${id}`);
    const { path, method, operation } = matches[0]!;
    const pathItem = object(object(document.paths)[path]);
    if (pathItem.parameters !== undefined || pathItem.servers !== undefined) throw new TypeError("Unsupported LOVO path-level transport");
    if (!/^\/[A-Za-z0-9/_.{}:-]+$/.test(path)) throw new TypeError("Unsupported LOVO operation path");
    if (operation.servers !== undefined || operation.callbacks !== undefined) throw new TypeError("Unsupported LOVO operation transport");
    const security = operation.security ?? document.security;
    if (!Array.isArray(security) || security.length !== 1 || Object.keys(object(security[0])).length !== 1) throw new TypeError("Unsupported LOVO security requirements");
    const schemeName = Object.keys(object(security[0]))[0]!;
    const scheme = object(object(components.securitySchemes)[schemeName]);
    if (scheme.type !== "apiKey" || scheme.in !== "header" || typeof scheme.name !== "string" || !Array.isArray(object(security[0])[schemeName]) || (object(security[0])[schemeName] as unknown[]).length) throw new TypeError("Unsupported LOVO authentication");
    const parameters = operation.parameters ?? [];
    if (!Array.isArray(parameters)) throw new TypeError("Invalid LOVO parameters");
    const fields: string[] = []; const paths = new Map<string, string>();
    const parameterSchemas: Record<string, unknown> = {};
    for (const raw of parameters) {
      const parameter = object(raw);
      if (parameter.in !== "path" || parameter.required !== true || typeof parameter.name !== "string" || paths.has(parameter.name)) throw new TypeError("Unsupported LOVO parameter");
      const item = compile(parameter.schema, `input[${JSON.stringify(parameter.name)}]`);
      if (item.type !== "string") throw new TypeError("LOVO path parameters must be strings");
      fields.push(`readonly ${JSON.stringify(parameter.name)}: string;`); paths.set(parameter.name, item.check);
      parameterSchemas[parameter.name] = parameter.schema;
    }
    const tokens = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!);
    if (tokens.length !== paths.size || tokens.some(token => !paths.has(token))) throw new TypeError("LOVO path template and parameters disagree");
    let input = { type: `{ ${fields.join(" ")} }`, check: `(${["typeof input === \"object\"", "input !== null", ...paths.values()].join(" && ")})` };
    let inputSchema: unknown = { type: "object", properties: parameterSchemas, required: [...paths.keys()] };
    const body = operation.requestBody;
    if (body !== undefined) {
      if (paths.size || object(body).required !== true) throw new TypeError("Unsupported LOVO request body");
      const content = object(object(body).content);
      if (Object.keys(content).join() !== "application/json") throw new TypeError("Unsupported LOVO request content type");
      input = compile(object(content["application/json"]).schema, "input");
      inputSchema = object(content["application/json"]).schema;
    }
    const responses = Object.entries(object(operation.responses)).filter(([status]) => /^2\d\d$/.test(status));
    if (responses.length !== 1) throw new TypeError("Expected one LOVO success response");
    const [status, response] = responses[0]!; const content = object(object(response).content);
    if (Object.keys(content).join() !== "application/json") throw new TypeError("Unsupported LOVO response content type");
    const output = compile(object(content["application/json"]).schema, "value");
    operations.push({ id, name, path, method, header: scheme.name, input: inputSchema,
      output: object(content["application/json"]).schema, status: Number(status), body: body !== undefined, parameters: tokens });
    let pathCode = JSON.stringify(path);
    for (const token of tokens) pathCode += `.replace(${JSON.stringify(`{${token}}`)}, encodeURIComponent(input[${JSON.stringify(token)}]))`;
    methods.push(`export const ${name}Status = ${status};
export function ${name}(input: ${input.type}, options: ClientOptions): Promise<Response> {
  if (!${input.check}) throw new TypeError(${JSON.stringify(`Invalid LOVO ${id} request`)});
  const url = new URL(options.baseUrl);
  url.pathname = url.pathname.replace(/\\/$/, "") + ${pathCode};
  return options.fetch(url, { method: ${JSON.stringify(method.toUpperCase())},
    headers: { ${JSON.stringify(scheme.name)}: options.apiKey${body === undefined ? "" : ', "content-type": "application/json"'} },
    ${body === undefined ? "" : "body: JSON.stringify(input), "}signal: options.signal, redirect: "error",
  });
}
export function decode${name[0]!.toUpperCase() + name.slice(1)}(value: unknown): ${output.type} {
  if (!${output.check}) throw new TypeError(${JSON.stringify(`Invalid LOVO ${id} response`)});
  return value as ${output.type};
}`);
  }
  const typescript = `// Generated by codegen/generate-clients.ts from ${sourceUrl}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";
export const defaultBaseUrl = ${JSON.stringify(server)};
export interface ClientOptions { readonly apiKey: string; readonly baseUrl: string; readonly fetch: Fetch; readonly signal: AbortSignal }
${[...definitions].sort(([a], [b]) => a.localeCompare(b)).map(([name, compiled]) => `export type ${name} = ${compiled.type};\nfunction valid${name}(value: unknown): value is ${name} { return ${compiled.check}; }`).join("\n")}
${methods.join("\n")}
`;
  return { typescript, python: renderLovoPythonClient({ schemas, operations, baseUrl: server, sourceUrl }) };
}
