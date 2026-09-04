import { reactFlightRecords, resolveReactFlightValue } from "./react-flight.ts";

interface Parameter {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly enum?: readonly string[];
  readonly description?: string;
  readonly children?: readonly Parameter[];
}

interface Operation {
  readonly method: string;
  readonly path: string;
  readonly server: string;
  readonly bodyParams: readonly Parameter[];
  readonly responses: readonly { readonly status: string; readonly name: string; readonly body: unknown }[];
}

interface Message {
  readonly name: string;
  readonly params: readonly Parameter[];
}

interface Channel {
  readonly protocol: string;
  readonly serverUrl: string;
  readonly address: string;
  readonly clientMessages: readonly Message[];
  readonly serverMessages: readonly Message[];
}

export interface InworldContracts {
  readonly server: string;
  readonly synchronousPath: string;
  readonly streamingPath: string;
  readonly webSocketServer: string;
  readonly webSocketPath: string;
  readonly models: readonly string[];
  readonly httpAudioEncodings: readonly string[];
  readonly webSocketAudioEncodings: readonly string[];
  readonly sampleRates: readonly number[];
  readonly deliveryModes: readonly string[];
  readonly timestampTypes: readonly string[];
  readonly normalizationModes: readonly string[];
  readonly timestampTransportStrategies: readonly string[];
}

function parameterSchema(value: Parameter): Record<string, unknown> {
  const array = value.type.endsWith("[]");
  const type = value.type.replace(/\[\]$/, "").replace(/^enum<string>$/, "string");
  let schema: Record<string, unknown>;
  if (type === "object") {
    const children = value.children ?? [];
    schema = {
      type: "object",
      properties: Object.fromEntries(children.map((child) => [child.name, parameterSchema(child)])),
      ...(children.some(({ required }) => required)
        ? { required: children.filter(({ required }) => required).map(({ name }) => name) }
        : {}),
    };
  } else {
    schema = { type: type === "integer" || type === "number" || type === "boolean" ? type : "string" };
  }
  if (value.enum) schema.enum = value.enum;
  if (value.description) schema.description = value.description;
  return array ? { type: "array", items: schema } : schema;
}

function exampleSchema(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { type: "array", items: value.length ? exampleSchema(value[0]) : {} };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return {
      type: "object",
      properties: Object.fromEntries(entries.map(([key, item]) => [key, exampleSchema(item)])),
      required: entries.map(([key]) => key),
    };
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
}

function requestSchema(parameters: readonly Parameter[]): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(parameters.map((value) => [value.name, parameterSchema(value)])),
    required: parameters.filter(({ required }) => required).map(({ name }) => name),
  };
}

function responses(operation: Operation, mediaType: string): Record<string, unknown> {
  const statuses = [...new Set(operation.responses.map(({ status }) => status))];
  return Object.fromEntries(statuses.map((status) => {
    const matching = operation.responses.filter((response) => response.status === status);
    const schemas = matching.map(({ body }) => exampleSchema(body));
    return [status, {
      description: status === "200" ? "Successful synthesis" : "Provider error",
      content: { [mediaType]: { schema: schemas.length === 1 ? schemas[0] : { oneOf: schemas } } },
    }];
  }));
}

/** Renders the resolved Mintlify operations into a stable OpenAPI generation input. */
export function renderInworldOpenApi(synchronousHtml: string, streamingHtml: string): string {
  const synchronous = operation(synchronousHtml, "/tts/v1/voice");
  const streaming = operation(streamingHtml, "/tts/v1/voice:stream");
  const streamingParameters = [
    ...synchronous.bodyParams,
    ...streaming.bodyParams.filter(({ name }) => name === "timestampTransportStrategy"),
  ];
  const post = (parameters: readonly Parameter[], operation: Operation, mediaType: string) => ({
    security: [{ basicAuth: [] }],
    requestBody: {
      required: true,
      content: { "application/json": { schema: requestSchema(parameters) } },
    },
    responses: responses(operation, mediaType),
  });
  return `${JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Inworld TTS extracted contract", version: "1" },
    servers: [{ url: synchronous.server }],
    paths: {
      [synchronous.path]: { post: post(synchronous.bodyParams, synchronous, "application/json") },
      [streaming.path]: { post: post(streamingParameters, streaming, "application/x-ndjson") },
    },
    components: {
      securitySchemes: { basicAuth: { type: "http", scheme: "basic" } },
    },
  }, null, 2)}\n`;
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Inworld ${name} must be an object`);
  }
  return value as Record<string, any>;
}

function embedded<T>(html: string, name: string, select: (value: Record<string, any>) => T | undefined): T {
  const records = reactFlightRecords(html);
  const matches: T[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const selected = select(value as Record<string, any>);
    if (selected !== undefined) matches.push(selected);
    else for (const item of Object.values(value)) visit(item);
  };
  for (const flight of records) if (flight.kind === "json") visit(flight.value);
  if (matches.length !== 1) throw new TypeError(`Expected one Inworld ${name}, found ${matches.length}`);
  return resolveReactFlightValue(records, matches[0]) as T;
}

function operation(html: string, path: string): Operation {
  return embedded(html, `POST ${path} operation`, (value) => {
    const endpoint = value.endpoint as Record<string, any> | undefined;
    return endpoint?.method === "POST" && endpoint.path === path ? endpoint as unknown as Operation : undefined;
  });
}

function channel(html: string): Channel {
  return embedded(html, "WebSocket channel", (value) => {
    const candidate = value.channel as Record<string, any> | undefined;
    return candidate?.protocol === "wss" ? candidate as unknown as Channel : undefined;
  });
}

function parameter(parameters: readonly Parameter[], name: string): Parameter {
  const matches = parameters.filter((value) => value.name === name);
  if (matches.length !== 1) throw new TypeError(`Expected one Inworld parameter: ${name}`);
  return matches[0]!;
}

function requireParameters(parameters: readonly Parameter[], expected: readonly string[], name: string): void {
  const actual = parameters.map(({ name }) => name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`Inworld ${name} parameters changed: ${actual.join(", ")}`);
  }
}

function enumValues(parameters: readonly Parameter[], name: string): readonly string[] {
  const values = parameter(parameters, name).enum;
  if (!values?.length || !values.every((value) => typeof value === "string")) {
    throw new TypeError(`Inworld ${name} enum changed`);
  }
  return values;
}

function message(messages: readonly Message[], name: string): Message {
  const value = messages.find((candidate) => candidate.name === name);
  if (!value) throw new TypeError(`Inworld WebSocket message is missing ${name}`);
  return value;
}

function models(llms: string): readonly string[] {
  const line = llms.split("\n").find((value) => value.startsWith("Models: "));
  if (!line) throw new TypeError("Inworld model catalog changed");
  const values = [...line.matchAll(/`(inworld-tts-[^`]+)`/g)].map((match) => match[1]!);
  if (values.length !== 3 || new Set(values).size !== values.length) {
    throw new TypeError("Inworld model catalog changed");
  }
  return values;
}

export function inworldContracts(
  synchronousHtml: string,
  streamingHtml: string,
  webSocketHtml: string,
  llms: string,
  synchronousMarkdown: string,
  webSocketMarkdown: string,
): InworldContracts {
  const synchronous = operation(synchronousHtml, "/tts/v1/voice");
  const streaming = operation(streamingHtml, "/tts/v1/voice:stream");
  const websocket = channel(webSocketHtml);
  if (synchronous.server !== "https://api.inworld.ai" || streaming.server !== synchronous.server) {
    throw new TypeError("Inworld HTTP server changed");
  }
  if (websocket.serverUrl !== "wss://api.inworld.ai"
    || websocket.address !== "/tts/v1/voice:streamBidirectional") {
    throw new TypeError("Inworld WebSocket endpoint changed");
  }
  requireParameters(synchronous.bodyParams, [
    "text", "voiceId", "audioConfig", "modelId", "language", "deliveryMode", "instruction",
    "temperature", "timestampType", "applyTextNormalization", "enhanceGeneration", "synthesisContext",
  ], "synchronous request");
  requireParameters(streaming.bodyParams, ["text", "timestampTransportStrategy"], "streaming request extension");
  const audio = parameter(synchronous.bodyParams, "audioConfig");
  requireParameters(audio.children ?? [], ["audioEncoding", "bitRate", "sampleRateHertz", "speakingRate"], "audioConfig");
  const sampleRateDescription = parameter(audio.children ?? [], "sampleRateHertz").description ?? "";
  const sampleRateList = /Supported sample rates are: ([0-9, ]+)\./.exec(sampleRateDescription)?.[1];
  const sampleRates = sampleRateList?.split(", ").map(Number);
  if (!sampleRates?.length || sampleRates.some((value) => !Number.isInteger(value))) {
    throw new TypeError("Inworld sample rates changed");
  }
  const responseNames = synchronous.responses.map(({ status, name }) => `${status}:${name}`);
  if (JSON.stringify(responseNames) !== JSON.stringify([
    "200:default_response", "200:word_response", "200:character_response", "4XX:default_response",
  ])) throw new TypeError("Inworld synchronous responses changed");
  const streamResponseNames = streaming.responses.map(({ status, name }) => `${status}:${name}`);
  if (JSON.stringify(streamResponseNames) !== JSON.stringify([
    "200:default_response", "200:async_response", "4XX:default_response",
  ])) throw new TypeError("Inworld streaming responses changed");

  if (JSON.stringify(websocket.clientMessages.map(({ name }) => name))
    !== JSON.stringify(["CreateContext", "SendText", "flushContext", "CloseContext"])
    || JSON.stringify(websocket.serverMessages.map(({ name }) => name))
      !== JSON.stringify(["ContextCreated", "AudioChunk", "ContextClosed", "FlushCompleted"])) {
    throw new TypeError("Inworld WebSocket messages changed");
  }
  const create = parameter(message(websocket.clientMessages, "CreateContext").params, "create");
  requireParameters(create.children ?? [], [
    "voiceId", "modelId", "audioConfig", "temperature", "timestampType", "maxBufferDelayMs",
    "bufferCharThreshold", "applyTextNormalization", "autoMode", "timestampTransportStrategy",
    "language", "deliveryMode",
  ], "WebSocket create context");
  const webSocketAudio = parameter(create.children ?? [], "audioConfig");
  requireParameters(webSocketAudio.children ?? [], ["audioEncoding", "sampleRateHertz", "bitRate", "speakingRate"], "WebSocket audioConfig");
  requireParameters(message(websocket.clientMessages, "SendText").params, ["send_text", "contextId"], "WebSocket send text");
  for (const name of ["ContextCreated", "AudioChunk", "ContextClosed", "FlushCompleted"]) {
    requireParameters(message(websocket.serverMessages, name).params, ["result"], `WebSocket ${name}`);
  }
  if (!synchronousMarkdown.includes("# Synthesize speech")
    || !webSocketMarkdown.includes("# Synthesize speech (WebSocket)")) {
    throw new TypeError("Inworld Markdown reference changed");
  }
  return {
    server: synchronous.server,
    synchronousPath: synchronous.path,
    streamingPath: streaming.path,
    webSocketServer: websocket.serverUrl,
    webSocketPath: websocket.address,
    models: models(llms),
    httpAudioEncodings: enumValues(audio.children ?? [], "audioEncoding"),
    webSocketAudioEncodings: enumValues(webSocketAudio.children ?? [], "audioEncoding"),
    sampleRates,
    deliveryModes: enumValues(synchronous.bodyParams, "deliveryMode"),
    timestampTypes: enumValues(synchronous.bodyParams, "timestampType"),
    normalizationModes: enumValues(synchronous.bodyParams, "applyTextNormalization"),
    timestampTransportStrategies: enumValues(streaming.bodyParams, "timestampTransportStrategy"),
  };
}

export function renderInworldClient(contract: InworldContracts, sources: readonly string[]): string {
  return `// Generated by codegen/generate-clients.ts from ${sources.join(" and ")}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";

export const modelIds = ${JSON.stringify(contract.models)} as const;
export type ModelId = (typeof modelIds)[number];
export const httpAudioEncodings = ${JSON.stringify(contract.httpAudioEncodings)} as const;
export type HttpAudioEncoding = (typeof httpAudioEncodings)[number];
export const webSocketAudioEncodings = ${JSON.stringify(contract.webSocketAudioEncodings)} as const;
export type WebSocketAudioEncoding = (typeof webSocketAudioEncodings)[number];
export const sampleRates = ${JSON.stringify(contract.sampleRates)} as const;
export type SampleRate = (typeof sampleRates)[number];
export const deliveryModes = ${JSON.stringify(contract.deliveryModes)} as const;
export type DeliveryMode = (typeof deliveryModes)[number];
export const timestampTypes = ${JSON.stringify(contract.timestampTypes)} as const;
export type TimestampType = (typeof timestampTypes)[number];
export const normalizationModes = ${JSON.stringify(contract.normalizationModes)} as const;
export type NormalizationMode = (typeof normalizationModes)[number];
export const timestampTransportStrategies = ${JSON.stringify(contract.timestampTransportStrategies)} as const;
export type TimestampTransportStrategy = (typeof timestampTransportStrategies)[number];

export interface AudioConfig<Encoding extends string = HttpAudioEncoding> {
  readonly audioEncoding?: Encoding;
  readonly bitRate?: number;
  readonly sampleRateHertz?: SampleRate;
  readonly speakingRate?: number;
}
export interface SynthesisContext { readonly previousRequests?: readonly { readonly text: string }[] }
export interface SpeechInput {
  readonly text: string;
  readonly voiceId: string;
  readonly audioConfig?: AudioConfig;
  readonly modelId: ModelId;
  readonly language?: string;
  readonly deliveryMode?: DeliveryMode;
  readonly instruction?: string;
  readonly temperature?: number;
  readonly timestampType?: TimestampType;
  readonly applyTextNormalization?: NormalizationMode;
  readonly enhanceGeneration?: boolean;
  readonly synthesisContext?: SynthesisContext;
}
export interface StreamingSpeechInput extends SpeechInput {
  readonly timestampTransportStrategy?: TimestampTransportStrategy;
}
export interface Phone {
  readonly phoneSymbol: string;
  readonly startTimeSeconds: number;
  readonly durationSeconds: number;
  readonly visemeSymbol?: string;
}
export interface WordAlignment {
  readonly words?: readonly string[];
  readonly wordStartTimeSeconds?: readonly number[];
  readonly wordEndTimeSeconds?: readonly number[];
  readonly phoneticDetails?: readonly {
    readonly wordIndex: number;
    readonly phones: readonly Phone[];
    readonly isPartial?: boolean;
  }[];
}
export interface CharacterAlignment {
  readonly characters?: readonly string[];
  readonly characterStartTimeSeconds?: readonly number[];
  readonly characterEndTimeSeconds?: readonly number[];
}
export interface TimestampInfo {
  readonly wordAlignment?: WordAlignment;
  readonly characterAlignment?: CharacterAlignment;
}
export interface Usage { readonly processedCharactersCount?: number; readonly modelId?: string }
export interface SpeechResult {
  readonly audioContent: string;
  readonly usage?: Usage;
  readonly timestampInfo?: TimestampInfo;
}
export interface Status { readonly code?: number; readonly message?: string; readonly details?: readonly unknown[] }

export interface CreateContext {
  readonly voiceId: string;
  readonly modelId: ModelId;
  readonly audioConfig?: AudioConfig<WebSocketAudioEncoding>;
  readonly temperature?: number;
  readonly timestampType?: TimestampType;
  readonly maxBufferDelayMs?: number;
  readonly bufferCharThreshold?: number;
  readonly applyTextNormalization?: NormalizationMode;
  readonly autoMode?: boolean;
  readonly timestampTransportStrategy?: TimestampTransportStrategy;
  readonly language?: string;
  readonly deliveryMode?: DeliveryMode;
}
export type ClientMessage =
  | { readonly create: CreateContext; readonly contextId?: string }
  | { readonly send_text: { readonly text: string; readonly flush_context?: Record<string, never> }; readonly contextId?: string }
  | { readonly flush_context: Record<string, never>; readonly contextId?: string }
  | { readonly close_context: Record<string, never>; readonly contextId?: string };
export type ServerMessage =
  | { readonly result: { readonly contextId?: string; readonly contextCreated: CreateContext; readonly status?: Status } }
  | { readonly result: { readonly contextId?: string; readonly audioChunk: SpeechResult & { readonly status?: Status } } }
  | { readonly result: { readonly contextId?: string; readonly contextClosed: Record<string, never>; readonly status?: Status } }
  | { readonly result: { readonly contextId?: string; readonly flushCompleted: Record<string, never>; readonly status?: Status } };

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: Fetch;
  readonly signal?: AbortSignal | null;
}

function request(path: string, input: SpeechInput, options: ClientOptions): Promise<Response> {
  return options.fetch(new URL(path, options.baseUrl), {
    method: "POST",
    headers: { authorization: \`Basic \${options.apiKey}\`, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: options.signal,
  });
}

export function createSpeech(input: SpeechInput, options: ClientOptions): Promise<Response> {
  return request(${JSON.stringify(contract.synchronousPath)}, input, options);
}

export function streamSpeech(input: StreamingSpeechInput, options: ClientOptions): Promise<Response> {
  return request(${JSON.stringify(contract.streamingPath)}, input, options);
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(\`Inworld returned invalid \${name}\`);
  return value as Record<string, unknown>;
}

export function parseSpeechResult(value: unknown): SpeechResult {
  const result = object(value, "speech result");
  if (typeof result.audioContent !== "string") throw new TypeError("Inworld speech result has no audioContent");
  if (result.timestampInfo !== undefined) object(result.timestampInfo, "timestampInfo");
  return result as unknown as SpeechResult;
}

export function parseStreamingSpeechResult(value: unknown): SpeechResult {
  return parseSpeechResult(object(value, "stream event").result);
}

export function encodeMessage(message: ClientMessage): string { return JSON.stringify(message); }

export function decodeMessage(data: unknown): ServerMessage {
  if (typeof data !== "string") throw new TypeError("Inworld returned a non-text WebSocket message");
  const value = object(JSON.parse(data) as unknown, "WebSocket event");
  const result = object(value.result, "WebSocket result");
  const known = ["contextCreated", "audioChunk", "contextClosed", "flushCompleted"]
    .filter((name) => result[name] !== undefined);
  if (known.length !== 1) throw new TypeError("Inworld returned an unknown WebSocket event");
  object(result[known[0]!], known[0]!);
  return value as unknown as ServerMessage;
}

export const defaultBaseUrl = ${JSON.stringify(contract.server)};
export const defaultWebSocketUrl = ${JSON.stringify(`${contract.webSocketServer}${contract.webSocketPath}`)};
`;
}
