import type { TtsRequest } from "../../../schemas/providers/google/index.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import * as grpc from "../../generated/clients/google-grpc.ts";
import * as grpcBeta from "../../generated/clients/google-grpc-beta.ts";
import * as rest from "../../generated/clients/google-rest.ts";
import * as restBeta from "../../generated/clients/google-rest-beta.ts";
import { validateRequest } from "../../generated/validators/google.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { connectGrpc, type GrpcConnect, type GrpcDuplex } from "../../runtime/grpc.ts";

export type { TtsRequest } from "../../../schemas/providers/google/index.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Override native Node/Bun HTTP/2, including for browser runtimes. */
  readonly grpc?: GrpcConnect;
  readonly baseUrl?: string;
  /** Origin of the streaming endpoint; the generated RPC path is appended. */
  readonly grpcUrl?: string;
  readonly signal?: AbortSignal;
  /** Deadline for the entire synthesis, including input and network waits. */
  readonly timeoutMs?: number;
}
export class GoogleError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(`Google ${statusCode}: ${message}`); this.name = "GoogleError"; this.statusCode = statusCode;
  }
}

const phonetics = { ipa: "PHONETIC_ENCODING_IPA", x_sampa: "PHONETIC_ENCODING_X_SAMPA", japanese_yomigana: "PHONETIC_ENCODING_JAPANESE_YOMIGANA", pinyin: "PHONETIC_ENCODING_PINYIN" } as const;
const categories = { hate_speech: "HARM_CATEGORY_HATE_SPEECH", dangerous_content: "HARM_CATEGORY_DANGEROUS_CONTENT", harassment: "HARM_CATEGORY_HARASSMENT", sexually_explicit: "HARM_CATEGORY_SEXUALLY_EXPLICIT" } as const;
const thresholds = { low: "BLOCK_LOW_AND_ABOVE", medium: "BLOCK_MEDIUM_AND_ABOVE", high: "BLOCK_ONLY_HIGH", none: "BLOCK_NONE", off: "OFF" } as const;
type Turn = { readonly speaker: string; readonly text: string };

function voice(request: TtsRequest): grpc.VoiceSelectionParams {
  if (request.model === "chirp-3-hd") return { languageCode: request.language, name: `${request.language}-Chirp3-HD-${request.voice}` };
  if (request.model === "chirp-3-instant-custom-voice") return { languageCode: request.language, voiceClone: { voiceCloningKey: request.voice } };
  return { languageCode: request.language, modelName: request.model,
    ...(request.speakers ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: request.speakers.map(speaker => ({ speakerAlias: speaker.alias, speakerId: speaker.voice })) } } : { name: request.voice }),
  };
}

function encoding(output: TtsRequest["output"]): grpc.AudioEncoding {
  switch (output.format) {
    case "wav": return output.sampleEncoding === "mulaw" ? "MULAW" : output.sampleEncoding === "alaw" ? "ALAW" : "LINEAR16";
    case "pcm": return "PCM";
    case "mp3": return "MP3";
    case "ogg_opus": return "OGG_OPUS";
    case "mulaw": return "MULAW";
    case "alaw": return "ALAW";
  }
}

function checkText(text: string, limit: number): void {
  if (new TextEncoder().encode(text).byteLength > limit) throw new TypeError(`Google input exceeds ${limit} UTF-8 bytes`);
}
function checkTurns(turns: readonly Turn[], aliases: ReadonlySet<string>, limit: number): void {
  for (const turn of turns) if (!aliases.has(turn.speaker)) throw new TypeError(`Google dialogue references an unknown speaker: ${turn.speaker}`);
  checkText(turns.map(turn => turn.text).join(""), limit);
}

interface StreamingOptions {
  readonly connect: GrpcConnect;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly aborted: Promise<never>;
  readonly codec: {
    readonly encodeStreamingRequest: typeof grpc.encodeStreamingRequest;
    readonly decodeStreamingResponse: typeof grpc.decodeStreamingResponse;
  };
  readonly config: grpc.StreamingSynthesizeConfig;
  readonly instructions: string | undefined;
  readonly inputType: "text" | "markup";
  readonly limit: number;
  readonly aliases: ReadonlySet<string>;
  readonly validateInput: (value: unknown, field?: string) => void;
}

async function* streaming(request: TtsRequest, options: StreamingOptions): AsyncIterableIterator<Uint8Array> {
  const opening = options.connect({ url: options.url, headers: options.headers, signal: options.signal });
  // An injected transport may resolve after cancellation. Do not leak that stream.
  void opening.then(connection => { if (options.signal.aborted) connection.close(); }, () => {});
  const connection: GrpcDuplex = await Promise.race([opening, options.aborted]);
  let source: AsyncIterator<string | Turn> | undefined; let inputDone = false;
  const field = request.turns === undefined ? "text" : "turns";
  const value = request.turns ?? request.text!;
  const incremental = typeof value !== "string" && !Array.isArray(value);
  try {
    source = incremental ? (value as AsyncIterable<string | Turn>)[Symbol.asyncIterator]() : undefined;
    const produce = (async () => {
      await connection.write(options.codec.encodeStreamingRequest({ streamingConfig: options.config }));
      let first = true;
      const send = async (value: string | readonly Turn[]) => {
        options.signal.throwIfAborted();
        if (typeof value === "string") checkText(value, options.limit);
        else checkTurns(value, options.aliases, options.limit);
        const input = typeof value === "string"
          ? options.inputType === "markup" ? { markup: value } : { text: value }
          : { multiSpeakerMarkup: { turns: value } };
        await connection.write(options.codec.encodeStreamingRequest({ input: { ...input, ...(first && options.instructions !== undefined ? { prompt: options.instructions } : {}) } }));
        first = false;
      };
      if (source) {
        for (;;) {
          options.signal.throwIfAborted();
          const item = await source.next();
          options.signal.throwIfAborted();
          if (item.done) break;
          options.validateInput(item.value, field);
          await send(typeof item.value === "string" ? item.value : [item.value]);
        }
      } else await send(value as string | readonly Turn[]);
      options.signal.throwIfAborted();
      inputDone = true; connection.end();
    })().then(() => ({ kind: "inputDone" as const }));
    // Observe failures even if cancellation wins before the response loop starts.
    void produce.catch(() => {});
    const responses = connection.responses[Symbol.asyncIterator]();
    const next = () => Promise.resolve().then(() => responses.next()).then(value => ({ kind: "output" as const, value }));
    let pending = next(); let produced = false;
    for (;;) {
      const event = await Promise.race(produced ? [pending, options.aborted] : [pending, produce, options.aborted]);
      options.signal.throwIfAborted();
      if (event.kind === "inputDone") { produced = true; continue; }
      if (event.value.done) {
        if (!inputDone) throw new TypeError("Google completed before the input stream ended");
        return;
      }
      const packet = options.codec.decodeStreamingResponse(event.value.value);
      if (packet.audioContent?.byteLength) yield packet.audioContent;
      pending = next();
    }
  } finally {
    if (source && !inputDone) {
      // An iterator's return() may wait for its pending next(); never wait on it.
      try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
    }
    connection.close();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array> {
  const validateInput = validateRequest(request);
  const gemini = request.model.startsWith("gemini-");
  const clone = request.model === "chirp-3-instant-custom-voice";
  const limit = gemini ? 4000 : 5000;
  // UTF-8 byte limits and cross-field references remain protocol checks.
  const aliases = new Set(request.speakers?.map(speaker => speaker.alias));
  if (request.speakers && aliases.size !== request.speakers.length) throw new TypeError("Google dialogue requires exactly two distinct speaker aliases");
  if (request.safetySettings && new Set(request.safetySettings.map(setting => setting.category)).size !== request.safetySettings.length) throw new TypeError("Google safety categories must be unique");
  if (typeof request.text === "string") checkText(request.text, limit);
  if (Array.isArray(request.turns)) checkTurns(request.turns, aliases, limit);
  if (request.instructions !== undefined) checkText(request.instructions, 4000);

  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey = options.auth?.google?.apiKey ?? environment.SPEECHSWITCH_GOOGLE_API_KEY ?? environment.GOOGLE_API_KEY;
  const accessToken = options.auth?.google?.accessToken ?? environment.SPEECHSWITCH_GOOGLE_ACCESS_TOKEN ?? environment.GOOGLE_OAUTH_ACCESS_TOKEN;
  const quotaProject = options.auth?.google?.quotaProject ?? environment.SPEECHSWITCH_GOOGLE_QUOTA_PROJECT ?? environment.GOOGLE_CLOUD_QUOTA_PROJECT;
  if (!apiKey && !accessToken) throw new TypeError("Missing auth.google.apiKey or auth.google.accessToken configuration");
  const headers: Record<string, string> = {
    ...(apiKey ? { "x-goog-api-key": apiKey } : {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    ...(quotaProject ? { "x-goog-user-project": quotaProject } : {}),
  };
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? rest.defaultBaseUrl;
  const connect = options.grpc ?? connectGrpc;
  const codec = clone ? grpcBeta : grpc;
  const grpcUrl = new URL(options.grpcUrl ?? "https://texttospeech.googleapis.com");
  grpcUrl.pathname = grpcUrl.pathname.replace(/\/$/, "") + codec.streamingSynthesizePath;
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted();
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Google timeoutMs must be an integer between 0 and 2147483647");
  if (timeoutMs === 0) throw new DOMException("Google synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timeout = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Google synthesis deadline expired", "TimeoutError")), timeoutMs);
  const customPronunciations = request.replacements === undefined ? undefined : { pronunciations: request.replacements.map(item => ({ phrase: item.pattern, pronunciation: item.replacement, phoneticEncoding: phonetics[item.alphabet] })) };
  const advancedVoiceOptions = gemini ? {
    enableTextnorm: request.textNormalization ?? true,
    ...(request.safetySettings === undefined ? {} : { safetySettings: { settings: request.safetySettings.map(setting => ({ category: categories[setting.category], threshold: thresholds[setting.threshold] })) } }),
  } : undefined;
  const selectedVoice = voice(request);
  const audioConfig: rest.AudioConfig = { audioEncoding: encoding(request.output), sampleRateHertz: request.output.sampleRateHz, speakingRate: request.speed ?? 1,
    volumeGainDb: request.volumeDb, pitch: request.pitchSemitones, effectsProfileId: request.effectsProfiles };
  try {
    const http = request.output.format === "wav" || request.output.format === "mp3" || request.inputType === "ssml"
      || request.volumeDb !== undefined || request.pitchSemitones !== undefined || request.effectsProfiles !== undefined;
    if (!http) {
      yield* streaming(request, { connect, url: grpcUrl.href, headers, signal, aborted, codec,
        config: { voice: selectedVoice, streamingAudioConfig: { audioEncoding: encoding(request.output), sampleRateHertz: request.output.sampleRateHz, speakingRate: request.speed ?? 1 }, customPronunciations, advancedVoiceOptions },
        instructions: request.instructions, inputType: request.inputType === "markup" ? "markup" : "text", limit, aliases, validateInput });
      return;
    }
    const input: rest.SynthesisInput = { prompt: request.instructions, customPronunciations,
      ...(request.turns ? { multiSpeakerMarkup: { turns: request.turns as readonly Turn[] } }
        : request.inputType === "ssml" ? { ssml: request.text as string }
        : request.inputType === "markup" ? { markup: request.text as string } : { text: request.text as string }),
    };
    const client = clone ? restBeta : rest;
    const response = await Promise.race([client.synthesizeSpeech({ input, voice: selectedVoice, audioConfig, advancedVoiceOptions }, { fetch, baseUrl, headers, signal }), aborted]);
    if (!response.ok) {
      const body = await Promise.race([response.text(), aborted]);
      let message = body;
      try { const error: unknown = JSON.parse(body); if (error && typeof error === "object" && "error" in error && error.error && typeof error.error === "object" && "message" in error.error && typeof error.error.message === "string") message = error.error.message; } catch {}
      throw new GoogleError(response.status, message);
    }
    const body: unknown = await Promise.race([response.json(), aborted]);
    if (!body || typeof body !== "object" || !("audioContent" in body) || typeof body.audioContent !== "string") throw new TypeError("Google returned an invalid synthesis response");
    signal.throwIfAborted();
    yield decodeBase64(body.audioContent);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    signal.removeEventListener("abort", abort); lifetime.abort();
  }
}
