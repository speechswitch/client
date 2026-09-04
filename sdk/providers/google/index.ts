import type { TtsRequest } from "../../../schemas/providers/google/index.ts";
import {
  listVoices,
  synthesizeSpeech,
  type AudioEncoding,
  type ClientOptions,
  type SynthesizeSpeechInput,
} from "../../generated/clients/google.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/google/index.ts";
export { listVoices } from "../../generated/clients/google.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
}

const encodings = {
  mp3: "MP3",
  wav: "LINEAR16",
  pcm: "PCM",
  ogg_opus: "OGG_OPUS",
  mulaw: "MULAW",
  alaw: "ALAW",
  aac: "M4A",
} as const satisfies Readonly<Record<TtsRequest["output"]["format"], AudioEncoding>>;

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  const accessToken = options.auth?.google?.accessToken
    ?? environment().SPEECHSWITCH_GOOGLE_ACCESS_TOKEN
    ?? environment().GOOGLE_OAUTH_ACCESS_TOKEN;
  const apiKey = options.auth?.google?.apiKey
    ?? environment().SPEECHSWITCH_GOOGLE_API_KEY
    ?? environment().GOOGLE_API_KEY;
  if (!accessToken && !apiKey) throw new TypeError("Missing auth.google.accessToken or auth.google.apiKey configuration");
  return {
    credential: accessToken
      ? { kind: "accessToken", value: accessToken }
      : { kind: "apiKey", value: apiKey! },
    baseUrl: options.baseUrl ?? "https://texttospeech.googleapis.com",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function input(request: TtsRequest): SynthesizeSpeechInput {
  return {
    input: request.inputType === "ssml" ? { ssml: request.text } : { text: request.text },
    voice: {
      languageCode: request.language,
      name: request.voice,
      modelName: request.model,
    },
    audioConfig: {
      audioEncoding: encodings[request.output.format],
      sampleRateHertz: request.output.sampleRateHz,
      speakingRate: request.speed,
      pitch: request.pitchSemitones,
      volumeGainDb: request.volumeDb,
    },
  };
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Google Cloud TTS returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const response = await synthesizeSpeech(input(request), resolve(options));
  if (!response.ok) throw await responseError(response);
  const value = await response.json() as { readonly audioContent?: string };
  if (typeof value.audioContent !== "string") throw new TypeError("Google Cloud TTS returned no audio content");
  yield decodeBase64(value.audioContent);
}

export interface VoiceOptions extends SynthesizeOptions { readonly language?: string }

export function voices(options: VoiceOptions = {}) {
  return listVoices(options.language, resolve(options));
}
