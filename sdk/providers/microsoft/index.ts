import type { TtsRequest } from "../../../schemas/providers/microsoft/index.ts";
import {
  createSpeech,
  listVoices,
  resourceVoiceListPath,
  synthesisPath,
  type ClientOptions,
} from "../../generated/clients/microsoft.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/microsoft/index.ts";

export interface Voice {
  readonly Name: string;
  readonly DisplayName: string;
  readonly LocalName: string;
  readonly ShortName: string;
  readonly Gender: "Female" | "Male";
  readonly Locale: string;
  readonly LocaleName: string;
  readonly StyleList?: readonly string[];
  readonly RolePlayList?: readonly string[];
  readonly SecondaryLocaleList?: readonly string[];
  readonly SampleRateHertz: string;
  readonly VoiceType: string;
  readonly Status: string;
  readonly WordsPerMinute?: string;
}

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly region?: string;
  readonly resourceEndpoint?: string;
  readonly synthesisUrl?: string;
  readonly signal?: AbortSignal;
  readonly userAgent?: string;
}

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function credential(options: SynthesizeOptions): ClientOptions["credential"] {
  const accessToken = options.auth?.microsoft?.accessToken
    ?? environment().SPEECHSWITCH_MICROSOFT_ACCESS_TOKEN;
  const apiKey = options.auth?.microsoft?.apiKey
    ?? environment().SPEECHSWITCH_MICROSOFT_API_KEY
    ?? environment().AZURE_SPEECH_KEY;
  if (!accessToken && !apiKey) {
    throw new TypeError("Missing auth.microsoft.accessToken or auth.microsoft.apiKey configuration");
  }
  return accessToken
    ? { kind: "accessToken", value: accessToken }
    : { kind: "apiKey", value: apiKey! };
}

function serviceRoot(options: SynthesizeOptions): { readonly url: string; readonly resource: boolean } {
  if (options.resourceEndpoint) return { url: options.resourceEndpoint, resource: true };
  const region = options.region
    ?? environment().SPEECHSWITCH_MICROSOFT_REGION
    ?? environment().AZURE_SPEECH_REGION;
  if (!region) throw new TypeError("Missing Microsoft Azure Speech region configuration");
  return { url: `https://${region}.tts.speech.microsoft.com`, resource: false };
}

function client(url: string, options: SynthesizeOptions): ClientOptions {
  return {
    url,
    credential: credential(options),
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function synthesisUrl(options: SynthesizeOptions): string {
  if (options.synthesisUrl) return options.synthesisUrl;
  return new URL(synthesisPath, serviceRoot(options).url).href;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function ssml(request: TtsRequest): string {
  if (request.inputType === "ssml") return request.text;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(request.language)}"><voice name="${escapeXml(request.voice)}">${escapeXml(request.text)}</voice></speak>`;
}

function outputFormat(output: TtsRequest["output"]): string {
  if (output.format === "mp3") {
    return `audio-${output.sampleRateHz / 1000}khz-${output.bitRateBps / 1000}kbitrate-mono-mp3`;
  }
  if (output.format === "ogg_opus") {
    return `ogg-${output.sampleRateHz / 1000}khz-16bit-mono-opus`;
  }
  if (output.format === "pcm") {
    const rate = output.sampleRateHz === 22050 || output.sampleRateHz === 44100
      ? `${output.sampleRateHz}hz`
      : `${output.sampleRateHz / 1000}khz`;
    return `raw-${rate}-16bit-mono-pcm`;
  }
  if (output.format === "wav") {
    const rate = output.sampleRateHz === 22050 || output.sampleRateHz === 44100
      ? `${output.sampleRateHz}hz`
      : `${output.sampleRateHz / 1000}khz`;
    return `riff-${rate}-16bit-mono-pcm`;
  }
  return `raw-8khz-8bit-mono-${output.format}`;
}

async function responseError(response: Response): Promise<TypeError> {
  const detail = (await response.text()).trim();
  return new TypeError(`Microsoft Azure Speech returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const response = await createSpeech(
    ssml(request),
    outputFormat(request.output),
    options.userAgent ?? "speechswitch-client",
    client(synthesisUrl(options), options),
  );
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new TypeError("Microsoft Azure Speech returned no audio stream");
  yield* response.body;
}

export interface VoiceOptions extends SynthesizeOptions {
  readonly voicesUrl?: string;
}

function voiceListUrl(options: VoiceOptions): string {
  if (options.voicesUrl) return options.voicesUrl;
  const root = serviceRoot(options);
  const path = root.resource ? resourceVoiceListPath : resourceVoiceListPath.replace(/^\/tts/, "");
  return new URL(path, root.url).href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function voice(value: unknown): Voice {
  if (!isRecord(value) || typeof value.Name !== "string" || typeof value.DisplayName !== "string"
    || typeof value.LocalName !== "string" || typeof value.ShortName !== "string"
    || (value.Gender !== "Female" && value.Gender !== "Male") || typeof value.Locale !== "string"
    || typeof value.LocaleName !== "string" || typeof value.SampleRateHertz !== "string"
    || typeof value.VoiceType !== "string" || typeof value.Status !== "string") {
    throw new TypeError("Microsoft Azure Speech returned an invalid voice");
  }
  return value as unknown as Voice;
}

export async function voices(options: VoiceOptions = {}): Promise<readonly Voice[]> {
  const value = await listVoices(client(voiceListUrl(options), options));
  if (!Array.isArray(value)) throw new TypeError("Microsoft Azure Speech returned an invalid voice list");
  return value.map(voice);
}
