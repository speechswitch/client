export interface MurfContracts {
  readonly generatePath: string;
  readonly streamPath: string;
  readonly voicesPath: string;
  readonly webSocketUrl: string;
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Murf ${name} must be an object`);
  return value as Record<string, any>;
}

function operation(paths: Record<string, any>, path: string, id: string): Record<string, any> {
  const value = record(record(paths[path], path).post ?? record(paths[path], path).get, path);
  if (value.operationId !== id) throw new TypeError(`Murf operation changed: ${path}`);
  return value;
}

function reference(value: unknown, expected: string, name: string): void {
  if (record(value, name).$ref !== `#/components/schemas/${expected}`) throw new TypeError(`Murf ${name} changed`);
}

function properties(schemas: Record<string, any>, name: string, expected: readonly string[]): void {
  const actual = Object.keys(record(record(schemas[name], name).properties, `${name} properties`));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`Murf ${name} properties changed`);
}

export function murfContracts(openApiValue: unknown, asyncApiValue: unknown): MurfContracts {
  const openapi = record(openApiValue, "OpenAPI document");
  if (openapi.openapi !== "3.1.0" || record(openapi.info, "OpenAPI info").title !== "API Reference") {
    throw new TypeError("Murf OpenAPI identity changed");
  }
  const paths = record(openapi.paths, "OpenAPI paths");
  const generatePath = "/v1/speech/generate";
  const streamPath = "/v1/speech/stream";
  const voicesPath = "/v1/speech/voices";
  const generate = operation(paths, generatePath, "generate");
  const stream = operation(paths, streamPath, "stream");
  const voices = operation(paths, voicesPath, "get-voices");
  const requestReference = (value: Record<string, any>, expected: string, name: string) => reference(record(record(
    record(value.requestBody, `${name} request body`).content, `${name} request content`)["application/json"],
    `${name} JSON request`).schema, expected, `${name} request`);
  requestReference(generate, "GenerateSpeechRequest", "generate");
  requestReference(stream, "GenerateSpeechStreamingRequest", "stream");
  const voiceResponse = record(record(record(voices.responses, "voice responses")["200"], "voice response").content,
    "voice response content")["application/json"];
  reference(record(record(voiceResponse, "voice JSON response").schema, "voice response schema").items,
    "ApiVoice", "voice item");
  const schemas = record(record(openapi.components, "OpenAPI components").schemas, "OpenAPI schemas");
  properties(schemas, "GenerateSpeechStreamingRequest", [
    "model", "channelType", "format", "multiNativeLocale", "locale", "pitch", "rate", "sampleRate",
    "style", "text", "variation", "voiceId",
  ]);
  properties(schemas, "GenerateSpeechRequest", [
    "audioDuration", "channelType", "encodeAsBase64", "format", "modelVersion", "multiNativeLocale",
    "locale", "pitch", "rate", "sampleRate", "style", "text", "variation", "voiceId",
    "wordDurationsAsOriginalText",
  ]);
  properties(schemas, "GenerateSpeechResponse", [
    "audioFile", "audioLengthInSeconds", "consumedCharacterCount", "encodedAudio",
    "remainingCharacterCount", "warning", "wordDurations",
  ]);
  properties(schemas, "ApiVoice", [
    "accent", "availableStyles", "description", "displayLanguage", "displayName", "gender", "locale",
    "supportedLocales", "voiceId",
  ]);

  const asyncapi = record(asyncApiValue, "AsyncAPI document");
  if (asyncapi.asyncapi !== "2.6.0" || record(asyncapi.info, "AsyncAPI info").title !== "API Reference") {
    throw new TypeError("Murf AsyncAPI identity changed");
  }
  const channel = record(record(asyncapi.channels, "AsyncAPI channels")["/stream-input"], "stream-input channel");
  if (record(channel.publish, "publish").operationId !== "stream-input-publish"
    || record(channel.subscribe, "subscribe").operationId !== "stream-input-subscribe") {
    throw new TypeError("Murf stream-input operations changed");
  }
  const server = record(record(asyncapi.servers, "AsyncAPI servers")["Default server"], "default server");
  const webSocketUrl = `${server.url}/stream-input`;
  if (server.protocol !== "wss" || webSocketUrl !== "wss://global.api.murf.ai/v1/speech/stream-input") {
    throw new TypeError("Murf WebSocket server changed");
  }
  const asyncSchemas = record(record(asyncapi.components, "AsyncAPI components").schemas, "AsyncAPI schemas");
  for (const [name, expected] of [
    ["audioOutput", ["audio", "context_id"]],
    ["finalOutput", ["final", "context_id"]],
    ["setVoiceConfigurationOrInitializeContext", ["voice_config", "context_id"]],
    ["sendText", ["text", "context_id", "end", "voice_config"]],
    ["setAdvancedSettings", ["min_buffer_size", "max_buffer_delay_in_ms"]],
    ["clearContext", ["clear", "context_id"]],
  ] as const) properties(asyncSchemas, name, expected);
  const models = record(asyncSchemas.model, "streaming model").enum;
  if (JSON.stringify(models) !== JSON.stringify(["falcon-2", "gen2"])) throw new TypeError("Murf models changed");
  return { generatePath, streamPath, voicesPath, webSocketUrl };
}

export function renderMurfClient(contract: MurfContracts, sources: readonly string[]): string {
  return `// Generated by codegen/generate-clients.ts from ${sources.join(", ")}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";

export interface SpeechSettings {
  readonly channelType: "MONO";
  readonly format: "MP3" | "FLAC" | "WAV" | "ALAW" | "ULAW" | "PCM";
  readonly locale?: string;
  readonly rate?: number;
  readonly sampleRate: number;
  readonly style?: string;
  readonly variation?: number;
  readonly text: string;
  readonly voiceId: string;
}

export interface StreamSpeechRequest extends SpeechSettings { readonly model: "falcon-2" | "gen2" }
export interface GenerateSpeechRequest extends SpeechSettings {
  readonly modelVersion: "GEN2";
  readonly encodeAsBase64?: false;
  readonly wordDurationsAsOriginalText: true;
}

export interface WordDuration { readonly startMs?: number; readonly endMs?: number; readonly word?: string }
export interface GenerateSpeechResponse {
  readonly audioFile: string;
  readonly encodedAudio?: string;
  readonly wordDurations: readonly WordDuration[];
}

export interface Voice {
  readonly description?: string;
  readonly displayName?: string;
  readonly gender?: "Male" | "Female" | "NonBinary";
  readonly locale?: string;
  readonly supportedLocales?: Readonly<Record<string, { readonly availableStyles?: readonly string[]; readonly detail?: string }>>;
  readonly voiceId?: string;
}

export type WebSocketClientMessage =
  | { readonly voice_config: { readonly voice_id: string; readonly style?: string; readonly rate?: number; readonly variation?: number; readonly locale?: string }; readonly context_id?: string }
  | { readonly text: string; readonly context_id?: string; readonly end?: boolean }
  | { readonly min_buffer_size?: number; readonly max_buffer_delay_in_ms?: number }
  | { readonly clear: true; readonly context_id: string };
export type WebSocketServerMessage =
  | { readonly audio: string; readonly context_id?: string | null }
  | { readonly final: boolean; readonly context_id?: string | null };

export const defaultWebSocketUrl = ${JSON.stringify(contract.webSocketUrl)};

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: Fetch;
  readonly signal?: AbortSignal;
}

function request(path: string | URL, options: ClientOptions, init: RequestInit = {}): Promise<Response> {
  return options.fetch(path instanceof URL ? path : new URL(path, options.baseUrl), {
    ...init, headers: { "api-key": options.apiKey, ...init.headers }, signal: options.signal,
  });
}

export function streamSpeech(input: StreamSpeechRequest, options: ClientOptions): Promise<Response> {
  return request(${JSON.stringify(contract.streamPath)}, options, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}

async function json<ResponseBody>(path: string | URL, options: ClientOptions, init: RequestInit = {}): Promise<ResponseBody> {
  const response = await request(path, options, init);
  if (!response.ok) throw new TypeError(\`Murf returned HTTP \${response.status}: \${await response.text()}\`);
  return response.json() as Promise<ResponseBody>;
}

export function generateSpeech(input: GenerateSpeechRequest, options: ClientOptions): Promise<GenerateSpeechResponse> {
  return json<GenerateSpeechResponse>(${JSON.stringify(contract.generatePath)}, options, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}

export function listVoices(model: "falcon-2" | "gen2" | undefined, options: ClientOptions): Promise<readonly Voice[]> {
  const url = new URL(${JSON.stringify(contract.voicesPath)}, options.baseUrl);
  if (model !== undefined) url.searchParams.set("model", model);
  return json<readonly Voice[]>(url, options);
}
`;
}
