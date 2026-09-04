import { reactFlightRecords, resolveReactFlightValue } from "./react-flight.ts";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Cartesia ${name} is not an object`);
  return value as RecordValue;
}

function find(value: unknown, predicate: (candidate: RecordValue) => boolean): RecordValue | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (!Array.isArray(value) && predicate(value as RecordValue)) return value as RecordValue;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return undefined;
}

function embedded(html: string, predicate: (candidate: RecordValue) => boolean): RecordValue {
  const records = reactFlightRecords(html);
  for (const flight of records) {
    if (flight.kind !== "json") continue;
    const candidate = find(flight.value, predicate);
    if (candidate) return record(resolveReactFlightValue(records, candidate), "embedded contract");
  }
  throw new TypeError("Cartesia page lost its embedded contract");
}

function operation(html: string, id: string): { readonly operation: RecordValue; readonly dependencies: RecordValue } {
  const value = embedded(html, (candidate) => {
    const operation = candidate.operation;
    return !!operation && typeof operation === "object" && !Array.isArray(operation)
      && (operation as RecordValue).operationId === id;
  });
  return { operation: record(value.operation, "operation"), dependencies: record(value.dependencies, "dependencies") };
}

function requestSchema(value: ReturnType<typeof operation>): RecordValue {
  const body = record(value.dependencies.requestBody, "request body");
  const content = record(body.content, "request body content");
  return record(record(content["application/json"], "JSON request body").schema, "request schema");
}

function properties(schema: RecordValue): RecordValue { return record(schema.properties, "schema properties"); }
function enumeration(schema: unknown, name: string): readonly (string | number)[] {
  const values = record(schema, name).enum;
  if (!Array.isArray(values) || !values.every((value) => typeof value === "string" || typeof value === "number")) {
    throw new TypeError(`Cartesia ${name} lost its enum`);
  }
  return values;
}

export interface CartesiaContract {
  readonly baseUrl: "https://api.cartesia.ai";
  readonly webSocketUrl: "wss://api.cartesia.ai/tts/websocket";
  readonly version: "2026-08-14";
  readonly models: readonly string[];
  readonly languages: readonly string[];
  readonly sampleRates: readonly number[];
  readonly mp3BitRates: readonly number[];
  readonly emotions: readonly string[];
}

export function cartesiaContract(
  bytesHtml: string,
  sseHtml: string,
  webSocketHtml: string,
  conventions: string,
  errors: string,
  limits: string,
  officialClient: string,
  contexts: string,
  flushing: string,
  buffering: string,
): CartesiaContract {
  const bytes = operation(bytesHtml, "tts_bytes");
  const sse = operation(sseHtml, "tts_sse");
  if (bytes.operation.method !== "post" || bytes.operation.path !== "/tts/bytes"
    || sse.operation.method !== "post" || sse.operation.path !== "/tts/sse") {
    throw new TypeError("Cartesia HTTP operations changed");
  }
  const parameters = Object.values(record(bytes.dependencies.parameters, "parameters"));
  const versionParameter = parameters.map((value) => record(value, "parameter")).find((value) => value.name === "Cartesia-Version");
  const version = enumeration(record(versionParameter?.schema, "version schema"), "versions")[0];
  if (version !== "2026-08-14") throw new TypeError("Cartesia API version changed");
  const schema = requestSchema(bytes);
  const fields = properties(schema);
  const models = enumeration(fields.model_id, "models").filter((value): value is string => typeof value === "string");
  const language = record(fields.language, "language");
  const languageSchema = Array.isArray(language.oneOf) ? record(language.oneOf[0], "language variant") : language;
  const languages = enumeration(languageSchema, "languages").filter((value): value is string => typeof value === "string");
  const formats = record(fields.output_format, "output format").oneOf;
  if (!Array.isArray(formats) || formats.length !== 3) throw new TypeError("Cartesia output formats changed");
  const raw = formats.map((value) => record(value, "output format")).find((value) => enumeration(properties(value).container, "container").includes("raw"));
  const mp3 = formats.map((value) => record(value, "output format")).find((value) => enumeration(properties(value).container, "container").includes("mp3"));
  if (!raw || !mp3) throw new TypeError("Cartesia lost raw or MP3 output");
  const sampleRates = enumeration(properties(raw).sample_rate, "sample rates").filter((value): value is number => typeof value === "number");
  const mp3BitRates = enumeration(properties(mp3).bit_rate, "MP3 bit rates").filter((value): value is number => typeof value === "number");
  const emotions = enumeration(properties(record(fields.generation_config, "generation config")).emotion, "emotions").filter((value): value is string => typeof value === "string");

  const channelRoot = embedded(webSocketHtml, (candidate) => candidate.channelId === "/tts/websocket");
  const channel = record(channelRoot.channel, "WebSocket channel");
  const send = channel.sendMessages;
  const receive = channel.receiveMessages;
  if (!Array.isArray(send) || !Array.isArray(receive)
    || JSON.stringify(send.map((value) => record(value, "client message").id)) !== JSON.stringify(["generationRequest", "cancelRequest"])
    || JSON.stringify(receive.map((value) => record(value, "server message").id)) !== JSON.stringify(["chunkResponse", "flushDoneResponse", "doneResponse", "timestampsResponse", "phonemeTimestampsResponse", "ttsErrorResponse"])) {
    throw new TypeError("Cartesia WebSocket messages changed");
  }
  const generation = record(record(send[0], "generation message").jsonPayloadSchema, "generation schema");
  const generationFields = properties(generation);
  for (const field of ["context_id", "continue", "flush", "max_buffer_delay_ms", "add_timestamps", "add_phoneme_timestamps", "use_normalized_timestamps"] as const) {
    if (!generationFields[field]) throw new TypeError(`Cartesia WebSocket generation lost ${field}`);
  }
  if (!conventions.includes("Authorization: Bearer <api_key>") || !conventions.includes("?access_token=<access_token>")
    || !errors.includes("concurrency_limited") || !limits.includes("5 minutes")
    || !officialClient.includes('title="post /tts/sse"') || !officialClient.includes("generateSSE") || !contexts.includes('"cancel": true')
    || !flushing.includes("Empty transcript") || !buffering.includes("Range:** 0–5000ms")) {
    throw new TypeError("Cartesia protocol documentation changed");
  }
  return { baseUrl: "https://api.cartesia.ai", webSocketUrl: "wss://api.cartesia.ai/tts/websocket", version, models, languages, sampleRates, mp3BitRates, emotions };
}

export function renderCartesiaClient(contract: CartesiaContract, urls: readonly string[]): string {
  const union = (values: readonly (string | number)[]) => values.map((value) => JSON.stringify(value)).join(" | ");
  return `// Generated by codegen/generate-clients.ts from ${urls.join(", ")}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";
export type Model = ${union(contract.models)};
export type Language = ${union(contract.languages)};
export type SampleRate = ${union(contract.sampleRates)};
export type Mp3BitRate = ${union(contract.mp3BitRates)};
export type Emotion = ${union(contract.emotions)};
export type RawEncoding = "pcm_f32le" | "pcm_s16le" | "pcm_mulaw" | "pcm_alaw";
export type OutputFormat = { readonly container: "raw" | "wav"; readonly encoding: RawEncoding; readonly sample_rate: SampleRate } | { readonly container: "mp3"; readonly sample_rate: SampleRate; readonly bit_rate: Mp3BitRate };
export interface GenerationConfig { readonly volume?: number; readonly speed?: number; readonly emotion?: Emotion }
export interface GenerationRequest { readonly model_id: Model; readonly transcript: string; readonly voice: string | { readonly id: string }; readonly output_format: OutputFormat; readonly language?: Language; readonly locale?: string; readonly accent?: string; readonly normalization?: string; readonly pronunciation_dict_id?: string; readonly generation_config?: GenerationConfig }
export interface StreamGenerationRequest extends GenerationRequest { readonly context_id: string; readonly continue?: boolean; readonly max_buffer_delay_ms?: number; readonly flush?: boolean; readonly add_timestamps?: boolean; readonly add_phoneme_timestamps?: boolean; readonly use_normalized_timestamps?: boolean }
export type ClientMessage = StreamGenerationRequest | { readonly context_id: string; readonly cancel: true };
export interface Timing { readonly words?: readonly string[]; readonly phonemes?: readonly string[]; readonly start?: readonly number[]; readonly end?: readonly number[] }
export type ServerMessage =
  | { readonly type: "chunk"; readonly data: string; readonly done: boolean; readonly status_code: number; readonly step_time: number; readonly context_id?: string }
  | { readonly type: "flush_done"; readonly done: boolean; readonly flush_done: boolean; readonly flush_id: number; readonly status_code: number; readonly context_id: string }
  | { readonly type: "done"; readonly done: boolean; readonly status_code: number; readonly context_id?: string }
  | { readonly type: "timestamps"; readonly done: boolean; readonly status_code: number; readonly context_id?: string; readonly word_timestamps?: Timing }
  | { readonly type: "phoneme_timestamps"; readonly done: boolean; readonly status_code: number; readonly context_id?: string; readonly phoneme_timestamps?: Timing }
  | { readonly type: "error"; readonly done?: boolean; readonly error_code?: string; readonly status_code: number; readonly title: string; readonly message: string; readonly doc_url?: string; readonly request_id?: string; readonly context_id?: string };
export interface ClientOptions { readonly credential: string; readonly fetch: Fetch; readonly baseUrl: string; readonly signal?: AbortSignal }
export const defaultBaseUrl = ${JSON.stringify(contract.baseUrl)};
export const defaultWebSocketUrl = ${JSON.stringify(contract.webSocketUrl)};
export const cartesiaVersion = ${JSON.stringify(contract.version)};
function request(path: string, input: GenerationRequest, options: ClientOptions): Promise<Response> { return options.fetch(new URL(path, options.baseUrl), { method: "POST", headers: { authorization: \`Bearer \${options.credential}\`, "cartesia-version": cartesiaVersion, "content-type": "application/json" }, body: JSON.stringify(input), signal: options.signal }); }
export function synthesizeBytes(input: GenerationRequest, options: ClientOptions): Promise<Response> { return request("/tts/bytes", input, options); }
export function synthesizeSse(input: GenerationRequest & { readonly add_timestamps?: boolean; readonly add_phoneme_timestamps?: boolean; readonly use_normalized_timestamps?: boolean; readonly context_id?: string }, options: ClientOptions): Promise<Response> { return request("/tts/sse", input, options); }
export function encodeMessage(message: ClientMessage): string { return JSON.stringify(message); }
export function decodeMessage(data: unknown): ServerMessage { if (typeof data !== "string") throw new TypeError("Cartesia returned a non-text WebSocket message"); const value: unknown = JSON.parse(data); if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Cartesia returned an invalid WebSocket message"); const type = (value as { readonly type?: unknown }).type; if (type !== "chunk" && type !== "flush_done" && type !== "done" && type !== "timestamps" && type !== "phoneme_timestamps" && type !== "error") throw new TypeError(\`Cartesia returned unknown WebSocket event: \${String(type)}\`); return value as ServerMessage; }
`;
}
