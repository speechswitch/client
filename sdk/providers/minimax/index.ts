import type { TtsRequest } from "../../../schemas/providers/minimax/index.ts";
import {
  streamSpeech,
  type ClientOptions,
  type T2aRequest,
} from "../../generated/clients/minimax.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/minimax/index.ts";

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
  const apiKey = options.auth?.minimax?.apiKey
    ?? environment().SPEECHSWITCH_MINIMAX_API_KEY
    ?? environment().MINIMAX_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.minimax.apiKey configuration");
  return {
    apiKey,
    baseUrl: options.baseUrl ?? "https://api.minimax.io",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function audioFormat(format: TtsRequest["output"]["format"]): string {
  if (format === "ogg_opus") return "opus";
  if (format === "mulaw") return "pcmu_raw";
  return format;
}

function input(request: TtsRequest): T2aRequest {
  return {
    model: request.model,
    text: request.text,
    stream: true,
    stream_options: { exclude_aggregated_audio: true },
    voice_setting: {
      voice_id: request.voice,
      speed: request.speed,
      vol: request.volumeScale,
      pitch: request.pitchSemitones,
      emotion: request.emotion,
      text_normalization: request.textNormalization,
    },
    audio_setting: {
      sample_rate: request.output.sampleRateHz,
      bitrate: request.output.format === "mp3" ? request.output.bitRateBps : undefined,
      format: audioFormat(request.output.format),
      channel: 1,
    },
    pronunciation_dict: request.replacements?.length
      ? { tone: request.replacements.map(({ pattern, replacement }) => `${pattern}/${replacement}`) }
      : undefined,
    language_boost: request.language,
    output_format: "hex",
  };
}

function decodeHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new TypeError("MiniMax returned invalid hexadecimal audio");
  }
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index++) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  let completed = false;
  let receivedAudio = false;
  for await (const message of streamSpeech(input(request), resolve(options))) {
    const statusCode = message.base_resp?.status_code;
    if (statusCode !== undefined && statusCode !== 0) {
      throw new TypeError(`MiniMax error ${statusCode}${message.base_resp?.status_msg ? `: ${message.base_resp.status_msg}` : ""}`);
    }
    if (message.data?.audio) {
      receivedAudio = true;
      yield decodeHex(message.data.audio);
    }
    if (message.data?.status === 2) completed = true;
  }
  if (!completed) throw new TypeError("MiniMax audio stream ended before synthesis completed");
  if (!receivedAudio) throw new TypeError("MiniMax completed without audio");
}
