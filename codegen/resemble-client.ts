export type ResembleModel = "chatterbox" | "chatterbox-multilingual" | "chatterbox-turbo";

export interface ResembleEndpoint {
  readonly model: ResembleModel;
  readonly baseUrl: string;
  readonly apiName: string;
  readonly parameterNames: readonly string[];
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly bounds: Readonly<Record<string, readonly [number, number]>>;
  readonly languages?: readonly string[];
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Resemble ${name} must be an object`);
  }
  return value as Record<string, any>;
}

function endpoint(
  value: unknown,
  model: ResembleModel,
  baseUrl: string,
  apiName: string,
  expectedParameters: readonly string[],
): ResembleEndpoint {
  const manifest = record(value, `${model} manifest`);
  const named = record(manifest.named_endpoints, `${model} named endpoints`);
  const definition = record(named[`/${apiName}`], `${model} endpoint`);
  if (Object.keys(named).filter((name) => name === `/${apiName}`).length !== 1
    || definition.api_visibility !== "public" && definition.show_api !== true) {
    throw new TypeError(`Resemble ${model} public endpoint changed`);
  }
  if (!Array.isArray(definition.parameters) || !Array.isArray(definition.returns)) {
    throw new TypeError(`Resemble ${model} endpoint shape changed`);
  }
  const parameters = definition.parameters.map((value: unknown) => record(value, `${model} parameter`));
  const parameterNames = parameters.map(({ parameter_name }) => parameter_name);
  if (JSON.stringify(parameterNames) !== JSON.stringify(expectedParameters)) {
    throw new TypeError(`Resemble ${model} parameters changed`);
  }
  const componentPythonTypes: Readonly<Record<string, string>> = {
    Textbox: "str", Audio: "filepath", Slider: "float", Number: "float", Checkbox: "bool",
  };
  for (const parameter of parameters) {
    const component = parameter.component;
    const pythonType = record(parameter.python_type, "Python type").type;
    if (parameter.parameter_has_default !== true || typeof component !== "string" || typeof pythonType !== "string"
      || component !== "Dropdown" && componentPythonTypes[component] !== pythonType
      || component === "Dropdown" && !pythonType.startsWith("Literal[")) {
      throw new TypeError(`Resemble ${model} parameter defaults changed`);
    }
  }
  const result = record(definition.returns[0], `${model} return`);
  if (result.component !== "Audio" || record(result.python_type, "return Python type").type !== "filepath"
    || !record(result.type, "return type").required.includes("path")) {
    throw new TypeError(`Resemble ${model} audio return changed`);
  }
  const defaults = Object.fromEntries(parameters.map(({ parameter_name, parameter_default }) => [parameter_name, parameter_default]));
  const bounds = Object.fromEntries(parameters.flatMap((parameter) => {
    const description = record(parameter.type, `${model} parameter type`).description;
    if (description === undefined) return [];
    const match = /^numeric value between (-?\d+(?:\.\d+)?) and (-?\d+(?:\.\d+)?)$/.exec(description);
    if (!match) throw new TypeError(`Resemble ${model} numeric bounds changed: ${description}`);
    return [[parameter.parameter_name, [Number(match[1]), Number(match[2])] as const]];
  }));
  const language = parameters.find(({ parameter_name }) => parameter_name === "language_id_input");
  const languages = language === undefined ? undefined : record(language.type, "language type").enum;
  if (languages !== undefined && (!Array.isArray(languages) || languages.some((item) => typeof item !== "string"))) {
    throw new TypeError("Resemble multilingual languages changed");
  }
  return { model, baseUrl, apiName, parameterNames, defaults, bounds, languages };
}

function validate(endpoint: ResembleEndpoint, expectedDefaults: Readonly<Record<string, unknown>>, expectedBounds: Readonly<Record<string, readonly [number, number]>>): void {
  for (const [name, value] of Object.entries(expectedDefaults)) {
    if (endpoint.defaults[name] !== value) throw new TypeError(`Resemble ${endpoint.model} ${name} default changed`);
  }
  if (JSON.stringify(endpoint.bounds) !== JSON.stringify(expectedBounds)) {
    throw new TypeError(`Resemble ${endpoint.model} numeric bounds changed`);
  }
}

export function resembleContracts(values: readonly unknown[]): readonly ResembleEndpoint[] {
  if (values.length !== 3) throw new TypeError("Resemble requires three Gradio manifests");
  const result = [
    endpoint(values[0], "chatterbox", "https://resembleai-chatterbox.hf.space", "generate_tts_audio", [
      "text_input", "audio_prompt_path_input", "exaggeration_input", "temperature_input", "seed_num_input", "cfgw_input", "vad_trim_input",
    ]),
    endpoint(values[1], "chatterbox-multilingual", "https://resembleai-chatterbox-multilingual-tts-v3.hf.space", "generate_tts_audio", [
      "text_input", "audio_prompt_path_input", "language_id_input", "exaggeration_input", "temperature_input", "seed_num_input", "cfgw_input",
    ]),
    endpoint(values[2], "chatterbox-turbo", "https://resembleai-chatterbox-turbo-demo.hf.space", "generate", [
      "text", "audio_prompt_path", "temperature", "seed_num", "min_p", "top_p", "top_k", "repetition_penalty", "norm_loudness",
    ]),
  ] as const;
  validate(result[0], { exaggeration_input: 0.5, temperature_input: 0.8, seed_num_input: 0, cfgw_input: 0.5, vad_trim_input: false }, {
    exaggeration_input: [0.25, 2], temperature_input: [0.05, 5], cfgw_input: [0.2, 1],
  });
  validate(result[1], { language_id_input: "en", exaggeration_input: 0.5, temperature_input: 0.8, seed_num_input: 0, cfgw_input: 0.5 }, {
    exaggeration_input: [0.25, 2], temperature_input: [0.05, 5], cfgw_input: [0.2, 1],
  });
  validate(result[2], { temperature: 0.8, seed_num: 0, min_p: 0, top_p: 0.95, top_k: 1000, repetition_penalty: 1.2, norm_loudness: true }, {
    temperature: [0.05, 2], min_p: [0, 1], top_p: [0, 1], top_k: [0, 1000], repetition_penalty: [1, 2],
  });
  if (result[1].languages?.length !== 23) throw new TypeError("Resemble multilingual language count changed");
  return result;
}

export function renderResembleClient(endpoints: readonly ResembleEndpoint[], sources: readonly string[]): string {
  const configs = Object.fromEntries(endpoints.map(({ model, baseUrl, apiName }) => [model, { baseUrl, apiName }]));
  const languages = endpoints.find(({ model }) => model === "chatterbox-multilingual")?.languages ?? [];
  return `// Generated by codegen/generate-clients.ts from ${sources.join(", ")}. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";

export type ResembleModel = ${endpoints.map(({ model }) => JSON.stringify(model)).join(" | ")};
export type ChatterboxLanguage = ${languages.map((value) => JSON.stringify(value)).join(" | ")};
export interface FileData { readonly path: string; readonly url?: string | null; readonly orig_name?: string | null; readonly mime_type?: string | null; readonly meta: { readonly _type: "gradio.FileData" } }
export interface ChatterboxRequest { readonly text_input: string; readonly audio_prompt_path_input?: FileData; readonly exaggeration_input: number; readonly temperature_input: number; readonly seed_num_input: number; readonly cfgw_input: number; readonly vad_trim_input: boolean }
export interface ChatterboxMultilingualRequest { readonly text_input: string; readonly audio_prompt_path_input?: FileData; readonly language_id_input: ChatterboxLanguage; readonly exaggeration_input: number; readonly temperature_input: number; readonly seed_num_input: number; readonly cfgw_input: number }
export interface ChatterboxTurboRequest { readonly text: string; readonly audio_prompt_path?: FileData; readonly temperature: number; readonly seed_num: number; readonly min_p: number; readonly top_p: number; readonly top_k: number; readonly repetition_penalty: number; readonly norm_loudness: boolean }
export type PredictionRequest = ChatterboxRequest | ChatterboxMultilingualRequest | ChatterboxTurboRequest;
export interface ClientOptions { readonly fetch: Fetch; readonly token?: string; readonly baseUrl?: string; readonly signal?: AbortSignal }
export const endpoints = ${JSON.stringify(configs, null, 2)} as const;

function headers(options: ClientOptions, json = false): Headers {
  const value = new Headers(json ? { "content-type": "application/json" } : undefined);
  if (options.token) value.set("authorization", \`Bearer \${options.token}\`);
  return value;
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  const detail = (await response.text()).trim();
  throw new TypeError(\`Resemble Chatterbox returned HTTP \${response.status}\${detail ? \`: \${detail}\` : ""}\`);
}

export async function upload(model: ResembleModel, audio: Uint8Array, options: ClientOptions): Promise<FileData> {
  const config = endpoints[model];
  const form = new FormData();
  form.append("files", new Blob([Uint8Array.from(audio)], { type: "audio/wav" }), "reference.wav");
  const response = await checked(await options.fetch(new URL("/gradio_api/upload", options.baseUrl ?? config.baseUrl), {
    method: "POST", headers: headers(options), body: form, signal: options.signal,
  }));
  const paths: unknown = await response.json();
  if (!Array.isArray(paths) || typeof paths[0] !== "string") throw new TypeError("Resemble Chatterbox returned an invalid upload path");
  return { path: paths[0], orig_name: "reference.wav", mime_type: "audio/wav", meta: { _type: "gradio.FileData" } };
}

export async function predict(model: ResembleModel, input: PredictionRequest, options: ClientOptions): Promise<FileData> {
  const config = endpoints[model];
  const response = await checked(await options.fetch(new URL(\`/gradio_api/run/\${config.apiName}\`, options.baseUrl ?? config.baseUrl), {
    method: "POST", headers: headers(options, true), body: JSON.stringify(input), signal: options.signal,
  }));
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("output" in body)) throw new TypeError("Resemble Chatterbox returned an invalid prediction");
  const output = (body as { readonly output: unknown }).output;
  if (!output || typeof output !== "object" || typeof (output as FileData).path !== "string") {
    throw new TypeError("Resemble Chatterbox returned an invalid audio file");
  }
  return output as FileData;
}

export async function download(file: FileData, model: ResembleModel, options: ClientOptions): Promise<Response> {
  const config = endpoints[model];
  const baseUrl = options.baseUrl ?? config.baseUrl;
  const url = file.url === undefined || file.url === null
    ? new URL(\`/gradio_api/file=\${file.path}\`, baseUrl)
    : new URL(file.url, baseUrl);
  return checked(await options.fetch(url, { headers: headers(options), signal: options.signal }));
}
`;
}
