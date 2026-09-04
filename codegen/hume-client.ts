interface HumeContracts {
  readonly formats: readonly string[];
  readonly timestampTypes: readonly string[];
  readonly versions: readonly string[];
  readonly voiceProviders: readonly string[];
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Hume ${name} must be an object`);
  }
  return value as Record<string, any>;
}

function enumValues(types: Record<string, any>, key: string): readonly string[] {
  const values = record(types[key], key).values;
  if (!Array.isArray(values) || !values.every((value) => typeof value?.wireValue === "string")) {
    throw new TypeError(`Hume ${key} enum changed`);
  }
  return values.map((value) => value.wireValue as string);
}

function propertyNames(types: Record<string, any>, key: string): readonly string[] {
  const properties = record(types[key], key).properties;
  if (!Array.isArray(properties)) throw new TypeError(`Hume ${key} properties changed`);
  return properties.map((property) => record(property.name, `${key} property`).wireValue as string);
}

function requireProperties(types: Record<string, any>, key: string, expected: readonly string[]): void {
  const properties = propertyNames(types, key);
  if (expected.some((name) => !properties.includes(name))) throw new TypeError(`Hume ${key} properties changed`);
}

function requireEndpoint(
  endpoints: Record<string, any>,
  key: string,
  method: string,
  path: string,
): void {
  const endpoint = record(endpoints[key], key);
  const location = record(endpoint.location, `${key} location`);
  if (location.method !== method || location.path !== path) throw new TypeError(`Hume ${key} endpoint changed`);
}

export function humeContracts(fern: unknown, openapiValue: unknown, asyncapiValue: unknown): HumeContracts {
  const language = record(record(fern, "Fern IR").typescript, "Fern TypeScript IR");
  const types = record(language.types, "Fern types");
  const endpoints = record(language.endpoints, "Fern endpoints");
  requireEndpoint(endpoints, "endpoint_tts.synthesize-file-streaming", "POST", "/v0/tts/stream/file");
  requireEndpoint(endpoints, "endpoint_tts.synthesize-json-streaming", "POST", "/v0/tts/stream/json");
  requireEndpoint(endpoints, "endpoint_tts.synthesize-file", "POST", "/v0/tts/file");
  requireEndpoint(endpoints, "endpoint_tts.synthesize-json", "POST", "/v0/tts");
  requireEndpoint(endpoints, "endpoint_tts/voices.list", "GET", "/v0/tts/voices");
  requireEndpoint(endpoints, "endpoint_tts/voices.create", "POST", "/v0/tts/voices");
  requireEndpoint(endpoints, "endpoint_tts/voices.delete", "DELETE", "/v0/tts/voices");
  requireProperties(types, "type_tts:PostedTts", [
    "context", "format", "include_timestamp_types", "num_generations", "strip_headers",
    "temperature", "utterances", "version", "instant_mode",
  ]);
  requireProperties(types, "type_tts:PostedUtterance", [
    "description", "speed", "text", "trailing_silence", "voice",
  ]);
  requireProperties(types, "type_tts:SnippetAudioChunk", [
    "audio", "audio_format", "chunk_index", "generation_id", "is_last_chunk", "request_id",
    "snippet_id", "text", "type",
  ]);
  requireProperties(types, "type_tts:TimestampMessage", [
    "generation_id", "request_id", "snippet_id", "timestamp", "type",
  ]);

  const formats = enumValues(types, "type_tts:AudioFormatType");
  const timestampTypes = enumValues(types, "type_tts:TimestampType");
  const versions = enumValues(types, "type_tts:OctaveVersion");
  const voiceProviders = enumValues(types, "type_tts:VoiceProvider");

  const openapi = record(openapiValue, "voice OpenAPI");
  const voicePath = record(record(openapi.paths, "OpenAPI paths")["/v0/tts/voices"], "voice path");
  if (voicePath.get?.operationId !== "list" || voicePath.post?.operationId !== "create"
    || voicePath.delete?.operationId !== "delete") {
    throw new TypeError("Hume voice operations changed");
  }

  const asyncapi = record(asyncapiValue, "AsyncAPI");
  const channel = record(record(asyncapi.channels, "AsyncAPI channels")["/stream/input"], "stream channel");
  if (channel.publish?.operationId !== "subpackage_streamInput.streamInput-publish"
    || channel.subscribe?.operationId !== "subpackage_streamInput.streamInput-subscribe") {
    throw new TypeError("Hume streaming operations changed");
  }
  const server = Object.values(record(asyncapi.servers, "AsyncAPI servers"))[0] as Record<string, any> | undefined;
  if (server?.url !== "wss://api.hume.ai/v0/tts") throw new TypeError("Hume streaming server changed");
  const schemas = record(record(asyncapi.components, "AsyncAPI components").schemas, "AsyncAPI schemas");
  const asyncFormats = record(schemas.FormatType, "AsyncAPI formats").enum;
  const asyncTimestamps = record(schemas.TimestampType, "AsyncAPI timestamp types").enum;
  if (JSON.stringify(asyncFormats) !== JSON.stringify(formats)
    || JSON.stringify(asyncTimestamps) !== JSON.stringify(timestampTypes)) {
    throw new TypeError("Hume Fern and AsyncAPI enums disagree");
  }
  const inputProperties = Object.keys(record(record(schemas.InputMessage, "InputMessage").properties, "InputMessage properties"));
  if (["close", "description", "flush", "speed", "text", "trailing_silence", "voice"]
    .some((name) => !inputProperties.includes(name))) {
    throw new TypeError("Hume streaming input changed");
  }
  return { formats, timestampTypes, versions, voiceProviders };
}

export function renderHumeClient(contract: HumeContracts, sources: readonly string[]): string {
  return `// Generated by codegen/generate-clients.ts from ${sources.join(" and ")}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";

export const formatTypes = ${JSON.stringify(contract.formats)} as const;
export type FormatType = (typeof formatTypes)[number];
export const timestampTypes = ${JSON.stringify(contract.timestampTypes)} as const;
export type TimestampType = (typeof timestampTypes)[number];
export const octaveVersions = ${JSON.stringify(contract.versions)} as const;
export type OctaveVersion = (typeof octaveVersions)[number];
export const voiceProviders = ${JSON.stringify(contract.voiceProviders)} as const;
export type VoiceProvider = (typeof voiceProviders)[number];

export interface VoiceReference { readonly id: string; readonly provider?: VoiceProvider }
export interface PostedUtterance {
  readonly text: string;
  readonly description?: string;
  readonly speed?: number;
  readonly trailing_silence?: number;
  readonly voice?: VoiceReference;
}
export interface PostedTts {
  readonly context?: { readonly generation_id: string };
  readonly format?: { readonly type: FormatType };
  readonly include_timestamp_types?: readonly TimestampType[];
  readonly num_generations?: number;
  readonly split_utterances?: boolean;
  readonly strip_headers?: boolean;
  readonly temperature?: number;
  readonly utterances: readonly PostedUtterance[];
  readonly version?: OctaveVersion;
  readonly instant_mode?: boolean;
}
export interface StreamInputMessage {
  readonly close?: boolean;
  readonly description?: string | null;
  readonly flush?: boolean;
  readonly speed?: number;
  readonly text?: string;
  readonly trailing_silence?: number;
  readonly voice?: VoiceReference | null;
}
export interface Timestamp {
  readonly text: string;
  readonly time: { readonly begin: number; readonly end: number };
  readonly type: TimestampType;
}
export interface Snippet {
  readonly audio: string;
  readonly generation_id: string;
  readonly id: string;
  readonly text: string;
  readonly timestamps: readonly Timestamp[];
  readonly transcribed_text: string | null;
  readonly utterance_index: number | null;
}
export interface AudioChunk {
  readonly type: "audio";
  readonly audio: string;
  readonly audio_format: FormatType;
  readonly chunk_index: number;
  readonly generation_id: string;
  readonly is_last_chunk: boolean;
  readonly request_id: string;
  readonly snippet?: Snippet;
  readonly snippet_id: string;
  readonly text: string;
  readonly transcribed_text: string | null;
  readonly utterance_index: number | null;
}
export interface TimestampMessage {
  readonly type: "timestamp";
  readonly generation_id: string;
  readonly request_id: string;
  readonly snippet_id: string;
  readonly timestamp: Timestamp;
}
export type TtsOutput = AudioChunk | TimestampMessage;

export interface Voice {
  readonly compatible_octave_models?: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly provider: VoiceProvider;
}
export interface VoicePage {
  readonly page_number: number;
  readonly page_size: number;
  readonly total_pages: number;
  readonly voices_page: readonly Voice[];
}
export interface CreatedVoice {
  readonly id: string | null;
  readonly name: string;
  readonly provider: VoiceProvider;
}
export interface VoiceListInput {
  readonly provider: VoiceProvider;
  readonly pageNumber?: number;
  readonly pageSize?: number;
  readonly ascendingOrder?: boolean;
  readonly filterTags?: readonly string[];
}

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: Fetch;
  readonly signal?: AbortSignal | null;
}

function request(path: string, options: ClientOptions, init: RequestInit = {}): Promise<Response> {
  return options.fetch(new URL(path, options.baseUrl), {
    ...init,
    headers: { "x-hume-api-key": options.apiKey, ...init.headers },
    signal: options.signal,
  });
}

function post(path: string, input: PostedTts, options: ClientOptions): Promise<Response> {
  return request(path, options, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function synthesizeFileStreaming(input: PostedTts, options: ClientOptions): Promise<Response> {
  return post("/v0/tts/stream/file", input, options);
}

export function synthesizeJsonStreaming(input: PostedTts, options: ClientOptions): Promise<Response> {
  return post("/v0/tts/stream/json", input, options);
}

async function json<ResponseBody>(path: string, options: ClientOptions, init?: RequestInit): Promise<ResponseBody> {
  const response = await request(path, options, init);
  if (!response.ok) throw new TypeError(\`Hume returned HTTP \${response.status}: \${await response.text()}\`);
  return response.json() as Promise<ResponseBody>;
}

export function listVoices(input: VoiceListInput, options: ClientOptions): Promise<VoicePage> {
  const query = new URLSearchParams({ provider: input.provider });
  if (input.pageNumber !== undefined) query.set("page_number", String(input.pageNumber));
  if (input.pageSize !== undefined) query.set("page_size", String(input.pageSize));
  if (input.ascendingOrder !== undefined) query.set("ascending_order", String(input.ascendingOrder));
  for (const tag of input.filterTags ?? []) query.append("filter_tag", tag);
  return json<VoicePage>(\`/v0/tts/voices?\${query}\`, options);
}

export function createVoice(
  input: { readonly generation_id: string; readonly name: string },
  options: ClientOptions,
): Promise<CreatedVoice> {
  return json<CreatedVoice>("/v0/tts/voices", options, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteVoice(name: string, options: ClientOptions): Promise<void> {
  const response = await request(\`/v0/tts/voices?name=\${encodeURIComponent(name)}\`, options, {
    method: "DELETE",
  });
  if (!response.ok) throw new TypeError(\`Hume returned HTTP \${response.status}: \${await response.text()}\`);
}

export function encodeStreamInputMessage(message: StreamInputMessage): string {
  return JSON.stringify(message);
}

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hume returned a non-object TTS event");
  }
  return value as Record<string, any>;
}

export function parseTtsOutput(input: unknown): TtsOutput {
  const value = object(input);
  if (value.type === "audio" && typeof value.audio === "string"
    && typeof value.audio_format === "string" && formatTypes.includes(value.audio_format as FormatType)
    && typeof value.chunk_index === "number" && typeof value.generation_id === "string"
    && typeof value.is_last_chunk === "boolean" && typeof value.request_id === "string"
    && typeof value.snippet_id === "string" && typeof value.text === "string") {
    return value as AudioChunk;
  }
  if (value.type === "timestamp" && typeof value.generation_id === "string"
    && typeof value.request_id === "string" && typeof value.snippet_id === "string") {
    const timestamp = object(value.timestamp);
    const time = object(timestamp.time);
    if (typeof timestamp.text === "string" && typeof timestamp.type === "string"
      && timestampTypes.includes(timestamp.type as TimestampType)
      && typeof time.begin === "number" && typeof time.end === "number") {
      return value as TimestampMessage;
    }
  }
  throw new TypeError(\`Hume returned unknown TTS event: \${String(value.type)}\`);
}

export function decodeTtsOutput(data: unknown): TtsOutput {
  if (typeof data !== "string") throw new TypeError("Hume returned a non-text WebSocket message");
  return parseTtsOutput(JSON.parse(data) as unknown);
}
`;
}
