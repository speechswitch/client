import type { Fetch } from "../../runtime/fetch.ts";

export interface OutputFormat {
  readonly codec: "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
  readonly sample_rate?: number;
  readonly bit_rate?: number;
}

export interface CreateSpeechInput {
  readonly text: string;
  readonly voice_id?: string;
  readonly output_format?: OutputFormat;
  readonly language: string;
  readonly optimize_streaming_latency?: "0" | "1" | "2";
  readonly text_normalization?: boolean;
  readonly with_timestamps?: boolean;
  readonly speed?: number;
  readonly replace?: Readonly<Record<string, string>>;
}

export interface CharacterTimes {
  readonly graph_chars: readonly string[];
  readonly graph_times: readonly (readonly [number, number])[];
}

export interface Voice {
  readonly voice_id: string;
  readonly name: string;
  readonly language?: string | null;
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
    headers: { authorization: `Bearer ${options.apiKey}`, ...init.headers },
    signal: options.signal,
  });
}

export function createSpeech(input: CreateSpeechInput, options: ClientOptions): Promise<Response> {
  return request("/v1/tts", options, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function listVoices(options: ClientOptions): Promise<readonly Voice[]> {
  const response = await request("/v1/tts/voices", options);
  if (!response.ok) throw new TypeError(`xAI returned HTTP ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { readonly voices: readonly Voice[] }).voices;
}

export async function getVoice(voiceId: string, options: ClientOptions): Promise<Voice> {
  const response = await request(`/v1/tts/voices/${encodeURIComponent(voiceId)}`, options);
  if (!response.ok) throw new TypeError(`xAI returned HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<Voice>;
}
