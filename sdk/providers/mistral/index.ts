import type { TtsRequest } from "../../../schemas/providers/mistral/index.ts";
import {
  createVoice as createVoiceRequest,
  deleteVoice as deleteVoiceRequest,
  getVoice,
  getVoiceSample,
  listVoices,
  streamSpeech,
  updateVoice as updateVoiceRequest,
  type ClientOptions,
  type VoiceCreateRequest,
  type VoiceUpdateRequest,
} from "../../generated/clients/mistral.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64, encodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/mistral/index.ts";
export type { Voice, VoicePage } from "../../generated/clients/mistral.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
}

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  const apiKey = options.auth?.mistral?.apiKey
    ?? environment().SPEECHSWITCH_MISTRAL_API_KEY
    ?? environment().MISTRAL_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.mistral.apiKey configuration");
  return {
    apiKey,
    baseUrl: options.baseUrl ?? "https://api.mistral.ai",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function format(value: TtsRequest["output"]["format"]): "pcm" | "wav" | "mp3" | "flac" | "opus" {
  return value === "ogg_opus" ? "opus" : value;
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  let done = false;
  for await (const event of streamSpeech({
    model: request.model,
    stream: true,
    voice_id: request.voice,
    ref_audio: request.referenceAudio === undefined ? undefined : encodeBase64(request.referenceAudio),
    input: request.text,
    response_format: format(request.output.format),
  }, resolve(options))) {
    if (event.type === "speech.audio.delta") yield decodeBase64(event.audio_data);
    else if (event.type === "speech.audio.done") done = true;
    else throw new TypeError("Mistral returned an unknown speech event");
  }
  if (!done) throw new TypeError("Mistral speech stream ended before the done event");
}

export interface VoiceOptions extends SynthesizeOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export function voices(options: VoiceOptions = {}) {
  return listVoices({ limit: options.limit, offset: options.offset }, resolve(options));
}

export function voice(voiceId: string, options: SynthesizeOptions = {}) {
  return getVoice(voiceId, resolve(options));
}

export interface CreateVoiceRequest extends Omit<VoiceCreateRequest, "sample_audio"> {
  readonly referenceAudio: Uint8Array;
}

export function createVoice(input: CreateVoiceRequest, options: SynthesizeOptions = {}) {
  const { referenceAudio, ...metadata } = input;
  return createVoiceRequest({ ...metadata, sample_audio: encodeBase64(referenceAudio) }, resolve(options));
}

export function updateVoice(voiceId: string, input: VoiceUpdateRequest, options: SynthesizeOptions = {}) {
  return updateVoiceRequest(voiceId, input, resolve(options));
}

export function deleteVoice(voiceId: string, options: SynthesizeOptions = {}) {
  return deleteVoiceRequest(voiceId, resolve(options));
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Mistral returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function* voiceSample(
  voiceId: string,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const response = await getVoiceSample(voiceId, resolve(options));
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Mistral returned no voice sample stream");
  yield* response.body;
}
