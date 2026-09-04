export interface KugelAudioContracts {
  readonly synthesizePath: string;
  readonly voicesPath: string;
  readonly voicePath: string;
  readonly modelsPath: string;
}

export interface KugelAudioDocumentation {
  readonly webSocketUrl: string;
  readonly models: readonly string[];
  readonly outputFormats: readonly string[];
}

export function kugelAudioDocumentation(
  generation: string,
  streamingInput: string,
  audioFormats: string,
  wordTimestamps: string,
  bargeIn: string,
  modelsSource: string,
): KugelAudioDocumentation {
  if (!generation.includes("POST /v1/tts/generate")
    || !generation.includes("Authorization: Bearer YOUR_API_KEY")) {
    throw new TypeError("KugelAudio native generation documentation changed");
  }
  const webSocketUrl = /```\n(wss:\/\/api\.kugelaudio\.com\/ws\/tts\/stream\?api_key=YOUR_API_KEY)\n```/
    .exec(streamingInput)?.[1];
  for (const value of [
    '"flush": true', '"close_socket": true', '"cancel": true', '"interrupted": true',
    '"session_closed": true', '"audio": "base64_encoded_pcm16_data"', '"word_timestamps": [',
  ]) {
    if (!streamingInput.includes(value)) throw new TypeError(`KugelAudio streaming documentation is missing ${value}`);
  }
  if (!webSocketUrl || !wordTimestamps.includes("Timestamp frames are delivered after their corresponding audio frames")
    || !bargeIn.includes("No further audio chunks for the cancelled turn are emitted after the")) {
    throw new TypeError("KugelAudio streaming semantics changed");
  }
  const outputFormats = [...audioFormats.matchAll(/^\| `(pcm_[0-9]+|ulaw_[0-9]+|alaw_[0-9]+)`/gm)]
    .map((match) => match[1]!);
  const models = [...modelsSource.matchAll(/^\| `(kugel-[^`]+)`/gm)].map((match) => match[1]!);
  if (JSON.stringify(outputFormats) !== JSON.stringify([
    "pcm_8000", "pcm_16000", "pcm_22050", "pcm_24000", "ulaw_8000", "alaw_8000",
  ]) || JSON.stringify(models) !== JSON.stringify([
    "kugel-3", "kugel-2.5", "kugel-2-turbo", "kugel-2", "kugel-1", "kugel-1-turbo",
  ])) throw new TypeError("KugelAudio documented models or output formats changed");
  return { webSocketUrl, models, outputFormats };
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`KugelAudio ${name} must be an object`);
  }
  return value as Record<string, any>;
}

function operation(
  paths: Record<string, any>,
  path: string,
  method: "get" | "post",
  operationId: string,
): Record<string, any> {
  const value = record(record(paths[path], path)[method], `${method.toUpperCase()} ${path}`);
  if (value.operationId !== operationId) throw new TypeError(`KugelAudio operation changed: ${method.toUpperCase()} ${path}`);
  return value;
}

function schemaReference(value: unknown, expected: string, name: string): void {
  if (record(value, name).$ref !== `#/components/schemas/${expected}`) {
    throw new TypeError(`KugelAudio ${name} schema changed`);
  }
}

function requireProperties(schemas: Record<string, any>, name: string, expected: readonly string[]): Record<string, any> {
  const schema = record(schemas[name], name);
  const actual = Object.keys(record(schema.properties, `${name} properties`));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`KugelAudio ${name} properties changed: ${actual.join(", ")}`);
  }
  return schema;
}

export function kugelAudioContracts(value: unknown): KugelAudioContracts {
  const openapi = record(value, "OpenAPI document");
  if (openapi.openapi !== "3.1.0" || record(openapi.info, "OpenAPI info").title !== "KugelAudio TTS API") {
    throw new TypeError("KugelAudio OpenAPI identity changed");
  }
  const paths = record(openapi.paths, "OpenAPI paths");
  const synthesizePath = "/v1/tts/generate";
  const voicesPath = "/v1/voices";
  const voicePath = "/v1/voices/{voice_id}";
  const modelsPath = "/v1/models";
  const synthesize = operation(paths, synthesizePath, "post", "generate_v1_tts_generate_post");
  const voices = operation(paths, voicesPath, "get", "get_voices_v1_voices_get");
  const voice = operation(paths, voicePath, "get", "get_voice_by_id_v1_voices__voice_id__get");
  const models = operation(paths, modelsPath, "get", "get_models_v1_models_get");
  const synthesizeContent = record(record(record(synthesize.requestBody, "synthesize request body").content,
    "synthesize request content")["application/json"], "synthesize JSON request");
  schemaReference(synthesizeContent.schema, "SynthesizeRequest", "synthesize request");
  const responseSchema = (operation: Record<string, any>, name: string) => record(record(
    record(record(operation.responses, `${name} responses`)["200"], `${name} response`).content,
    `${name} response content`,
  )["application/json"], `${name} JSON response`).schema;
  schemaReference(responseSchema(voices, "voices"), "VoicesResponse", "voices response");
  schemaReference(responseSchema(voice, "voice"), "VoiceInfo", "voice response");
  schemaReference(responseSchema(models, "models"), "ModelsResponse", "models response");

  const schemas = record(record(openapi.components, "OpenAPI components").schemas, "OpenAPI schemas");
  const synthesizeSchema = requireProperties(schemas, "SynthesizeRequest", [
    "text", "voice_id", "cfg_scale", "temperature", "max_new_tokens", "sample_rate", "language",
    "model_id", "normalize", "project_id", "dictionary_ids", "speed", "output_format",
  ]);
  if (synthesizeSchema.additionalProperties !== false
    || JSON.stringify(synthesizeSchema.required) !== JSON.stringify(["text"])) {
    throw new TypeError("KugelAudio SynthesizeRequest constraints changed");
  }
  requireProperties(schemas, "VoiceInfo", [
    "id", "voice_id", "handle", "public_id", "name", "description", "category", "sex", "age",
    "quality", "supported_languages", "sample_url", "avatar_url",
  ]);
  requireProperties(schemas, "VoicesResponse", ["voices", "total", "limit", "offset"]);
  requireProperties(schemas, "ModelInfo", [
    "id", "model_id", "name", "description", "parameters", "max_input_length", "sample_rate",
  ]);
  requireProperties(schemas, "ModelsResponse", ["models"]);
  return { synthesizePath, voicesPath, voicePath, modelsPath };
}

export function renderKugelAudioClient(contract: KugelAudioContracts, source: string): string {
  return `// Generated by codegen/generate-clients.ts from ${source}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";

export interface SynthesizeRequest {
  readonly text: string;
  readonly voice_id?: number | string | null;
  readonly cfg_scale?: number;
  readonly temperature?: number;
  readonly max_new_tokens?: number;
  readonly sample_rate?: number;
  readonly language?: string | null;
  readonly model_id?: string | null;
  readonly normalize?: boolean;
  readonly project_id?: number | null;
  readonly dictionary_ids?: readonly number[] | null;
  readonly speed?: number;
  readonly output_format?: string | null;
}

export interface Voice {
  readonly id: number;
  readonly voice_id: number;
  readonly handle?: string | null;
  readonly public_id?: string | null;
  readonly name: string;
  readonly description?: string | null;
  readonly category?: string;
  readonly sex?: string | null;
  readonly age?: string | null;
  readonly quality?: string;
  readonly supported_languages?: readonly string[];
  readonly sample_url?: string | null;
  readonly avatar_url?: string | null;
}

export interface VoicePage {
  readonly voices: readonly Voice[];
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface Model {
  readonly id: string;
  readonly model_id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly parameters?: string | null;
  readonly max_input_length?: number;
  readonly sample_rate?: number;
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
    headers: { authorization: \`Bearer \${options.apiKey}\`, ...init.headers },
    signal: options.signal,
  });
}

export function createSpeech(input: SynthesizeRequest, options: ClientOptions): Promise<Response> {
  return request(${JSON.stringify(contract.synthesizePath)}, options, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(input),
  });
}

async function json<ResponseBody>(path: string, options: ClientOptions): Promise<ResponseBody> {
  const response = await request(path, options);
  if (!response.ok) throw new TypeError(\`KugelAudio returned HTTP \${response.status}: \${await response.text()}\`);
  return response.json() as Promise<ResponseBody>;
}

export function listVoices(input: { readonly limit?: number; readonly offset?: number }, options: ClientOptions): Promise<VoicePage> {
  const url = new URL(${JSON.stringify(contract.voicesPath)}, options.baseUrl);
  if (input.limit !== undefined) url.searchParams.set("limit", String(input.limit));
  if (input.offset !== undefined) url.searchParams.set("offset", String(input.offset));
  return json<VoicePage>(url.href, options);
}

export function getVoice(voiceId: string, options: ClientOptions): Promise<Voice> {
  return json<Voice>(${JSON.stringify(contract.voicePath)}.replace("{voice_id}", encodeURIComponent(voiceId)), options);
}

export async function listModels(options: ClientOptions): Promise<readonly Model[]> {
  return (await json<{ readonly models: readonly Model[] }>(${JSON.stringify(contract.modelsPath)}, options)).models;
}
`;
}
