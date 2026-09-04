import type { TtsRequest } from "../../../schemas/providers/lovo/index.ts";
import {
  createSpeech,
  getSpeech,
  listSpeakers,
  type ClientOptions,
  type SpeechJob,
} from "../../generated/clients/lovo.ts";
import type { Auth } from "../../auth.ts";
import type { Fetch } from "../../runtime/fetch.ts";

export type { TtsRequest } from "../../../schemas/providers/lovo/index.ts";
export type {
  Speaker,
  SpeakerPage,
  SpeakerStyle,
} from "../../generated/clients/lovo.ts";

export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly pollIntervalMs?: number;
}

function environment(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

function apiKey(options: SynthesizeOptions): string {
  const value = options.auth?.lovo?.apiKey
    ?? environment().SPEECHSWITCH_LOVO_API_KEY
    ?? environment().LOVO_API_KEY;
  if (!value) throw new TypeError("Missing auth.lovo.apiKey configuration");
  return value;
}

function resolve(options: SynthesizeOptions): ClientOptions {
  return {
    apiKey: apiKey(options),
    baseUrl: options.baseUrl ?? "https://api.genny.lovo.ai",
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolveDelay, reject) => {
    const timeout = setTimeout(done, milliseconds);
    function done(): void {
      signal?.removeEventListener("abort", aborted);
      resolveDelay();
    }
    function aborted(): void {
      clearTimeout(timeout);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

async function completedJob(
  job: SpeechJob,
  client: ClientOptions,
  interval: number,
): Promise<SpeechJob> {
  let current = job;
  while (current.status === "in_progress") {
    await delay(interval, client.signal);
    current = await getSpeech(current.id, client);
  }
  return current;
}

function audioUrls(job: SpeechJob): readonly string[] {
  if (job.error) throw new TypeError(`LOVO job ${job.id} failed (${job.error.code}): ${job.error.message}`);
  const urls: string[] = [];
  for (const output of job.data) {
    if (output.status === "failed") {
      const detail = output.error ? ` (${output.error.code}): ${output.error.message}` : "";
      throw new TypeError(`LOVO speech output failed${detail}`);
    }
    if (output.status !== "succeeded" || !output.urls?.length) {
      throw new TypeError(`LOVO job ${job.id} completed without an audio URL`);
    }
    urls.push(...output.urls);
  }
  if (!urls.length) throw new TypeError(`LOVO job ${job.id} completed without an audio URL`);
  return urls;
}

export async function* synthesize(
  request: TtsRequest,
  options: SynthesizeOptions = {},
): AsyncIterableIterator<Uint8Array> {
  const client = resolve(options);
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new TypeError("pollIntervalMs must be a non-negative finite number");
  }
  const job = await completedJob(await createSpeech({
    text: request.text,
    speaker: request.voice,
    speakerStyle: request.voiceVariant,
    speed: request.speed,
  }, client), client, pollIntervalMs);
  for (const url of audioUrls(job)) {
    const response = await client.fetch(url, { signal: client.signal });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new TypeError(`LOVO audio download returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    if (!response.body) throw new TypeError("LOVO audio download returned no stream");
    yield* response.body;
  }
}

export interface VoiceOptions extends SynthesizeOptions {
  readonly sort?: readonly string[];
  readonly page?: number;
  readonly limit?: number;
}

export function voices(options: VoiceOptions = {}) {
  return listSpeakers({ sort: options.sort, page: options.page, limit: options.limit }, resolve(options));
}
