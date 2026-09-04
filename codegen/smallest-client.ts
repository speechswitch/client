interface Schema {
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly $ref?: string;
}
interface Document {
  readonly openapi?: string;
  readonly asyncapi?: string;
  readonly servers?: readonly { readonly url?: string; readonly host?: string; readonly pathname?: string; readonly protocol?: string }[] | Readonly<Record<string, { readonly host?: string; readonly pathname?: string; readonly protocol?: string }>>;
  readonly paths?: Readonly<Record<string, { readonly post?: { readonly operationId?: string; readonly requestBody?: { readonly content?: { readonly "application/json"?: { readonly schema?: Schema } } } } }>>;
  readonly channels?: Readonly<Record<string, { readonly address?: string; readonly messages?: Readonly<Record<string, { readonly payload?: Schema }>> }>>;
  readonly components?: { readonly schemas?: Readonly<Record<string, Schema>> };
}
export interface SmallestContracts {
  readonly httpServer: string;
  readonly syncPath: string;
  readonly livePath: string;
  readonly webSocketUrl: string;
  readonly models: readonly string[];
  readonly languages: readonly string[];
  readonly formats: readonly string[];
  readonly sampleRates: readonly number[];
}

function strings(value: readonly unknown[] | undefined, name: string): string[] {
  if (!value || value.some((item) => typeof item !== "string")) throw new TypeError(`Invalid Smallest.ai ${name}`);
  return [...value] as string[];
}
function numbers(value: readonly unknown[] | undefined, name: string): number[] {
  if (!value || value.some((item) => typeof item !== "number")) throw new TypeError(`Invalid Smallest.ai ${name}`);
  return [...value] as number[];
}
function referenced(document: Document, schema: Schema | undefined): Schema {
  if (!schema?.$ref) throw new TypeError("Smallest.ai request schema is no longer a reference");
  const name = schema.$ref.split("/").at(-1)!;
  const result = document.components?.schemas?.[name];
  if (!result) throw new TypeError(`Missing Smallest.ai schema ${name}`);
  return result;
}

export function smallestContracts(openApi: unknown, asyncApi: unknown, documentation: string): SmallestContracts {
  const http = openApi as Document;
  const websocket = asyncApi as Document;
  if (http.openapi !== "3.0.1" || websocket.asyncapi !== "3.0.0") throw new TypeError("Smallest.ai schema version changed");
  const sync = http.paths?.["/waves/v1/tts"]?.post;
  const live = http.paths?.["/waves/v1/tts/live"]?.post;
  if (sync?.operationId !== "synthesizeSpeech" || live?.operationId !== "synthesizeSpeechSse") throw new TypeError("Smallest.ai TTS operations changed");
  const request = referenced(http, sync.requestBody?.content?.["application/json"]?.schema);
  const liveRequest = referenced(http, live.requestBody?.content?.["application/json"]?.schema);
  if (request !== liveRequest || JSON.stringify(request.required) !== JSON.stringify(["text", "voice_id"])) throw new TypeError("Smallest.ai HTTP request requirements changed");
  const properties = request.properties ?? {};
  const expected = ["text", "voice_id", "model", "sample_rate", "speed", "language", "number_pronunciation_language", "math_notation", "output_format", "pronunciation_dicts", "word_timestamps", "session_id", "request_id"];
  if (JSON.stringify(Object.keys(properties)) !== JSON.stringify(expected)) throw new TypeError(`Smallest.ai HTTP fields changed: ${Object.keys(properties).join(", ")}`);
  if (properties.speed?.minimum !== 0.5 || properties.speed.maximum !== 2) throw new TypeError("Smallest.ai speed range changed");
  const channel = websocket.channels?.ttsStream;
  const wsRequest = channel?.messages?.["ttsRequest.message"]?.payload;
  const wsResponse = channel?.messages?.["ttsResponse.message"]?.payload;
  const wsProperties = wsRequest?.properties ?? {};
  const expectedWebSocket = ["voice_id", "text", "model", "max_buffer_flush_ms", "continue", "flush", "complete_backoff_ms", "context_id", "max_buffer_delay_ms", "context_close", "language", "number_pronunciation_language", "math_notation", "sample_rate", "speed", "session_id", "request_id", "word_timestamps"];
  if (JSON.stringify(Object.keys(wsProperties)) !== JSON.stringify(expectedWebSocket) || JSON.stringify(wsRequest?.required) !== JSON.stringify(["voice_id", "text"])) throw new TypeError(`Smallest.ai WebSocket fields changed: ${Object.keys(wsProperties).join(", ")}`);
  if (channel?.address !== "/waves/v1/tts/live" || JSON.stringify(wsResponse?.properties?.status?.enum) !== JSON.stringify(["chunk", "word_timestamp", "complete"])) throw new TypeError("Smallest.ai WebSocket messages changed");
  const servers = websocket.servers as Readonly<Record<string, { readonly host?: string; readonly pathname?: string; readonly protocol?: string }>>;
  const production = servers.production;
  if (production?.host !== "api.smallest.ai" || production.pathname !== channel.address || production.protocol !== "wss") throw new TypeError("Smallest.ai WebSocket server changed");
  if (!documentation.includes("Lightning v3.1") || documentation.includes("Lightning v2")) throw new TypeError("Smallest.ai model catalog changed");
  const httpServer = (http.servers as readonly { readonly url?: string }[])?.[0]?.url;
  if (httpServer !== "https://api.smallest.ai") throw new TypeError("Smallest.ai HTTP server changed");
  return {
    httpServer,
    syncPath: "/waves/v1/tts",
    livePath: "/waves/v1/tts/live",
    webSocketUrl: `wss://${production.host}${production.pathname}`,
    models: strings(properties.model?.enum, "models"),
    languages: strings(properties.language?.enum, "languages"),
    formats: strings(properties.output_format?.enum, "formats"),
    sampleRates: numbers(properties.sample_rate?.enum, "sample rates"),
  };
}

function union(values: readonly (string | number)[]): string { return values.map((value) => JSON.stringify(value)).join(" | "); }
export function renderSmallestClient(contract: SmallestContracts, sources: readonly string[]): string {
  return `// Generated by codegen/generate-clients.ts from ${sources.join(", ")}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";
export type Model = ${union(contract.models)};
export type Language = ${union(contract.languages)};
export type OutputFormat = ${union(contract.formats)};
export type SampleRate = ${union(contract.sampleRates)};
export interface TtsInput { readonly text: string; readonly voice_id: string; readonly model: Model; readonly sample_rate: SampleRate; readonly speed?: number; readonly language?: Language; readonly number_pronunciation_language?: Language; readonly math_notation?: boolean; readonly output_format: OutputFormat; readonly pronunciation_dicts?: readonly string[]; readonly word_timestamps?: boolean }
export interface WebSocketInput { readonly text?: string; readonly voice_id?: string; readonly model?: Model; readonly sample_rate?: SampleRate; readonly speed?: number; readonly language?: Language; readonly number_pronunciation_language?: Language; readonly math_notation?: boolean; readonly max_buffer_flush_ms?: number; readonly continue?: boolean; readonly flush?: boolean; readonly complete_backoff_ms?: number; readonly context_id?: string; readonly max_buffer_delay_ms?: number; readonly context_close?: boolean; readonly word_timestamps?: boolean; readonly request_id?: string }
export type WebSocketOutput = { readonly status: "chunk"; readonly data: { readonly audio: string }; readonly external_request_id?: string } | { readonly status: "word_timestamp"; readonly data: { readonly id: number; readonly word: string; readonly start: number; readonly end: number }; readonly external_request_id?: string } | { readonly status: "complete"; readonly external_request_id?: string } | { readonly status: "error"; readonly message?: string; readonly error?: { readonly message?: string; readonly code?: string } };
export type SseOutput = { readonly audio: string; readonly done: false; readonly status: "206" } | { readonly done: true; readonly status: "200" };
export interface ClientOptions { readonly apiKey: string; readonly fetch: Fetch; readonly baseUrl: string; readonly signal?: AbortSignal }
export const defaultBaseUrl = ${JSON.stringify(contract.httpServer)};
export const defaultWebSocketUrl = ${JSON.stringify(contract.webSocketUrl)};
export function synthesizeSync(input: TtsInput, options: ClientOptions): Promise<Response> { return options.fetch(\`${"${options.baseUrl}"}${contract.syncPath}\`, { method: "POST", headers: { authorization: \`Bearer ${"${options.apiKey}"}\`, accept: "audio/wav", "content-type": "application/json" }, body: JSON.stringify(input), signal: options.signal }); }
export function synthesizeSse(input: TtsInput, options: ClientOptions): Promise<Response> { return options.fetch(\`${"${options.baseUrl}"}${contract.livePath}\`, { method: "POST", headers: { authorization: \`Bearer ${"${options.apiKey}"}\`, accept: "text/event-stream", "content-type": "application/json" }, body: JSON.stringify(input), signal: options.signal }); }
`;
}
