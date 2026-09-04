export interface RespeecherContracts {
  readonly bytesPath: string;
  readonly ssePath: string;
  readonly voicesPath: string;
  readonly webSocketPath: string;
  readonly restServers: Readonly<Record<"en" | "uk", string>>;
  readonly webSocketServers: Readonly<Record<"en" | "uk", string>>;
  readonly encodings: readonly string[];
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Respeecher ${name} must be an object`);
  return value as Record<string, any>;
}

function operation(paths: Record<string, any>, path: string, id: string): Record<string, any> {
  const value = record(record(paths[path], path).post ?? record(paths[path], path).get, `${path} operation`);
  if (value.operationId !== id) throw new TypeError(`Respeecher operation changed: ${path}`);
  return value;
}

function properties(schemas: Record<string, any>, name: string, expected: readonly string[]): void {
  const actual = Object.keys(record(record(schemas[name], name).properties, `${name} properties`));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`Respeecher ${name} fields changed`);
}

export function respeecherContracts(openApiValue: unknown, asyncApiValue: unknown, references: readonly string[]): RespeecherContracts {
  const openapi = record(openApiValue, "OpenAPI document");
  if (openapi.openapi !== "3.1.0" || record(openapi.info, "OpenAPI info").title !== "API Reference") throw new TypeError("Respeecher OpenAPI identity changed");
  const paths = record(openapi.paths, "OpenAPI paths");
  const bytesPath = "/tts/bytes";
  const ssePath = "/tts/sse";
  const voicesPath = "/voices";
  operation(paths, bytesPath, "bytes");
  operation(paths, ssePath, "sse");
  operation(paths, voicesPath, "list");
  const servers = openapi.servers;
  if (!Array.isArray(servers) || servers.length !== 2) throw new TypeError("Respeecher REST servers changed");
  const restServers = { en: record(servers[0], "English server").url, uk: record(servers[1], "Ukrainian server").url };
  const schemas = record(record(openapi.components, "OpenAPI components").schemas, "OpenAPI schemas");
  properties(schemas, "type_tts:BytesGenerationRequest", ["transcript", "voice", "output_format"]);
  properties(schemas, "type_tts:StreamingGenerationRequest", ["transcript", "voice", "output_format"]);
  properties(schemas, "type_voices:SamplingParams", ["seed", "temperature", "top_k", "top_p", "min_p", "presence_penalty", "repetition_penalty", "frequency_penalty"]);
  const encodings = record(schemas["type_tts:StreamingEncoding"], "streaming encoding").enum;
  if (!Array.isArray(encodings) || JSON.stringify(encodings) !== JSON.stringify(["pcm_f32le", "pcm_s16le", "pcm_mulaw"])) throw new TypeError("Respeecher streaming encodings changed");

  const asyncapi = record(asyncApiValue, "AsyncAPI document");
  if (asyncapi.asyncapi !== "2.6.0" || record(asyncapi.info, "AsyncAPI info").title !== "API Reference") throw new TypeError("Respeecher AsyncAPI identity changed");
  const webSocketPath = "/tts/websocket";
  const channel = record(record(asyncapi.channels, "channels")[webSocketPath], "WebSocket channel");
  if (record(channel.publish, "publish").operationId !== "web-socket-publish" || record(channel.subscribe, "subscribe").operationId !== "web-socket-subscribe") throw new TypeError("Respeecher WebSocket operations changed");
  const asyncSchemas = record(record(asyncapi.components, "AsyncAPI components").schemas, "AsyncAPI schemas");
  properties(asyncSchemas, "type_tts:ContextfulGenerationRequest", ["transcript", "voice", "output_format", "context_id", "continue"]);
  properties(asyncSchemas, "type_tts:CancellationRequest", ["context_id", "cancel"]);
  const response = record(asyncSchemas["type_tts:Response"], "WebSocket response").oneOf;
  if (!Array.isArray(response) || JSON.stringify(response.map((item: unknown) => record(record(record(item, "response").properties, "response properties").type, "response type").enum?.[0])) !== JSON.stringify(["chunk", "done", "error"])) throw new TypeError("Respeecher WebSocket responses changed");
  const asyncServers = record(asyncapi.servers, "AsyncAPI servers");
  const webSocketServers = { en: record(asyncServers["public-en-rt"], "English WebSocket server").url, uk: record(asyncServers["public-ua-rt"], "Ukrainian WebSocket server").url };
  if (!references.some((value) => value.includes("JSONL (JSON lines)"))
    || !references.some((value) => value.includes("`X-API-Key` header, including on the WebSocket handshake"))
    || !references.some((value) => value.includes("setting `continue` to `true` in\nall but the last chunk"))) {
    throw new TypeError("Respeecher protocol documentation changed");
  }
  return { bytesPath, ssePath, voicesPath, webSocketPath, restServers, webSocketServers, encodings };
}

export function renderRespeecherClient(contract: RespeecherContracts, sources: readonly string[]): string {
  return `// Generated by codegen/generate-clients.ts from ${sources.join(", ")}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";

export interface SamplingParams { readonly seed?: number; readonly temperature?: number; readonly top_k?: number; readonly top_p?: number; readonly min_p?: number; readonly presence_penalty?: number; readonly repetition_penalty?: number; readonly frequency_penalty?: number }
export interface VoiceSelection { readonly id: string; readonly sampling_params?: SamplingParams }
export type StreamingEncoding = ${contract.encodings.map((value) => JSON.stringify(value)).join(" | ")};
export interface BytesRequest { readonly transcript: string; readonly voice: VoiceSelection; readonly output_format: { readonly sample_rate: number } }
export interface StreamingRequest { readonly transcript: string; readonly voice: VoiceSelection; readonly output_format: { readonly sample_rate: number; readonly encoding: StreamingEncoding } }
export interface ContextRequest extends StreamingRequest { readonly context_id: string; readonly continue: boolean }
export interface CancellationRequest { readonly context_id: string; readonly cancel: true }
export type ClientMessage = ContextRequest | CancellationRequest;
export type SseEvent = { readonly type: "chunk"; readonly data: string } | { readonly type: "error"; readonly error: string; readonly status_code: number; readonly context_id?: string };
export type ServerMessage = { readonly type: "chunk"; readonly data: string; readonly context_id: string } | { readonly type: "done"; readonly context_id: string } | { readonly type: "error"; readonly error: string; readonly status_code: number; readonly context_id?: string };
export interface Voice { readonly id: string; readonly full_name?: string; readonly gender?: "female" | "male"; readonly accent?: string; readonly age?: string; readonly sampling_params?: SamplingParams }
export interface ClientOptions { readonly apiKey: string; readonly language: "en" | "uk"; readonly fetch: Fetch; readonly baseUrl?: string; readonly signal?: AbortSignal }
export const restServers = ${JSON.stringify(contract.restServers)} as const;
export const webSocketServers = ${JSON.stringify(contract.webSocketServers)} as const;
export const webSocketPath = ${JSON.stringify(contract.webSocketPath)};

function request(path: string, options: ClientOptions, init: RequestInit = {}): Promise<Response> {
  const baseUrl = options.baseUrl ?? restServers[options.language];
  return options.fetch(\`\${baseUrl.replace(/\\\/$/, "")}\${path}\`, { ...init, headers: { "X-API-Key": options.apiKey, ...init.headers }, signal: options.signal });
}
export function bytes(input: BytesRequest, options: ClientOptions): Promise<Response> { return request(${JSON.stringify(contract.bytesPath)}, options, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); }
export function sse(input: StreamingRequest, options: ClientOptions): Promise<Response> { return request(${JSON.stringify(contract.ssePath)}, options, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); }
export async function voices(options: ClientOptions): Promise<readonly Voice[]> { const response = await request(${JSON.stringify(contract.voicesPath)}, options); if (!response.ok) throw new TypeError(\`Respeecher returned HTTP \${response.status}: \${await response.text()}\`); return response.json() as Promise<readonly Voice[]>; }
`;
}
