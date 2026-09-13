import type { TtsRequest, Output, MicrosoftEnvelope, MicrosoftDoneEvent, SynthesisItem } from "../../../schemas/providers/microsoft/index.ts";
import type { Auth } from "../../auth.ts";
import { validateRequest } from "../../generated/validators/microsoft.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { connectWebSocket, type WebSocketLike } from "../../websocket.ts";
import { decodeMessage, encodeMessage, type MicrosoftTimestamp } from "./protocol.ts";

export type { TtsRequest, MicrosoftEnvelope, MicrosoftDoneEvent, SynthesisItem } from "../../../schemas/providers/microsoft/index.ts";
export type { MicrosoftTimestamp } from "./protocol.ts";
export interface SynthesizeOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Exclusive authenticated socket; synthesis owns its lifetime. */
  readonly webSocket?: WebSocketLike;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  /** Existing custom voice deployment. Voice identity remains in the request. */
  readonly deploymentId?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export class MicrosoftError extends Error {
  readonly statusCode: number;
  readonly retryAfter: string | null;
  constructor(message: string, statusCode: number, retryAfter: string | null) {
    super(message); this.name = "MicrosoftError"; this.statusCode = statusCode; this.retryAfter = retryAfter;
  }
}

function outputFormat(output: Output): string {
  const rate = output.sampleRateHz === 22050 || output.sampleRateHz === 44100 ? `${output.sampleRateHz}hz` : `${output.sampleRateHz / 1000}khz`;
  switch (output.format) {
    case "mp3": return `audio-${rate}-${output.bitRateBps / 1000}kbitrate-mono-mp3`;
    case "pcm": return `raw-${rate}-16bit-mono-pcm`;
    case "wav": return output.sampleEncoding === "alaw" || output.sampleEncoding === "mulaw"
      ? `riff-8khz-8bit-mono-${output.sampleEncoding}` : `riff-${rate}-16bit-mono-pcm`;
    case "alaw": case "mulaw": return `raw-8khz-8bit-mono-${output.format}`;
    case "ogg_opus": return `ogg-${rate}-16bit-mono-opus`;
    case "opus": return `audio-${rate}-16bit-${output.bitRateBps / 1000}kbps-mono-opus`;
    case "webm_opus": return `webm-${rate}-16bit-${output.bitRateBps === undefined ? "" : `${output.bitRateBps / 1000}kbps-`}mono-opus`;
    case "truesilk": return `raw-${rate}-16bit-mono-truesilk`;
    case "amr_wb": return "amr-wb-16000hz";
    case "g722": return "g722-16khz-64kbps";
  }
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

interface SpeechSettings {
  readonly voice: string;
  readonly language: string;
  readonly rootLanguage: string;
  readonly textLanguage: string | null;
  readonly pitch: string | null;
  readonly rate: string | null;
  readonly volume: string | null;
  readonly style: string | null;
  readonly temperature: number | null;
  readonly parameters: string;
}

function settings(request: TtsRequest): SpeechSettings {
  const suffix = request.model === "dragon-hd" ? ":DragonHDLatestNeural"
    : request.model === "dragon-hd-omni" ? ":DragonHDOmniLatestNeural"
    : request.model === "dragon-hd-flash" ? ":DragonHDFlashLatestNeural"
    : request.model === "mai-voice-2" ? ":MAI-Voice-2"
    : request.model === "mai-voice-2-flash" ? ":MAI-Voice-2-Flash" : "";
  const temperature = request.model === "dragon-hd" ? request.temperature ?? 1
    : request.model === "dragon-hd-omni" ? request.temperature ?? 0.7 : null;
  const parameters: string[] = [];
  if (temperature !== null) parameters.push(`temperature=${temperature}`);
  if (request.topP !== undefined) parameters.push(`top_p=${request.topP}`);
  if (request.topK !== undefined) parameters.push(`top_k=${request.topK}`);
  if (request.voiceGuidance !== undefined) parameters.push(`cfg_scale=${request.voiceGuidance}`);
  if (request.namedEntityPronunciationEnhancement !== undefined) parameters.push(`enhancePronunciation=${request.namedEntityPronunciationEnhancement}`);
  const rate = request.speed === undefined ? null : String(request.speed);
  const hd = request.model === "dragon-hd" || request.model === "dragon-hd-omni" || request.model === "dragon-hd-flash";
  return { voice: `${request.voice ?? ""}${suffix}`, language: request.language ?? "en-US", rate,
    rootLanguage: hd ? "en-US" : request.language ?? "en-US", textLanguage: hd ? request.language ?? null : null,
    pitch: request.pitchSemitones === undefined ? null : `${request.pitchSemitones >= 0 ? "+" : ""}${request.pitchSemitones}st`,
    volume: request.volumeScale === undefined ? null : String(request.volumeScale * 100),
    style: request.emotion ?? null, temperature, parameters: parameters.join(";") };
}

function ssml(text: string, speech: SpeechSettings): string {
  let body = xml(text);
  // HD requires en-US on speak; an explicit speaking locale belongs on lang.
  if (speech.textLanguage !== null) body = `<lang xml:lang="${xml(speech.textLanguage)}">${body}</lang>`;
  if (speech.rate !== null || speech.pitch !== null || speech.volume !== null) {
    body = `<prosody${speech.rate === null ? "" : ` rate="${speech.rate}"`}${speech.pitch === null ? "" : ` pitch="${speech.pitch}"`}${speech.volume === null ? "" : ` volume="${speech.volume}"`}>${body}</prosody>`;
  }
  if (speech.style !== null) body = `<mstts:express-as style="${xml(speech.style)}">${body}</mstts:express-as>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${xml(speech.rootLanguage)}"><voice name="${xml(speech.voice)}"${speech.parameters ? ` parameters="${xml(speech.parameters)}"` : ""}>${body}</voice></speak>`;
}

async function* bytes(body: ReadableStream<Uint8Array>, signal: AbortSignal, aborted: Promise<never>): AsyncIterableIterator<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const item = await Promise.race([reader.read(), aborted]); signal.throwIfAborted();
      if (item.done) return; yield item.value;
    }
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function* streaming(request: TtsRequest, speech: SpeechSettings, markup: string | null, format: string,
  preferredLocales: string | null, socket: WebSocketLike, signal: AbortSignal, validateInput: (value: unknown) => void): AsyncIterableIterator<Uint8Array | MicrosoftEnvelope | MicrosoftDoneEvent> {
  const connection = await connectWebSocket({ socket, encode: encodeMessage, decode: decodeMessage, signal });
  const requestId = crypto.randomUUID().replaceAll("-", "");
  const granularity = request.timestampGranularity;
  const requested: readonly string[] = granularity === undefined ? [] : typeof granularity === "string" ? [granularity] : Array.from({ length: granularity.length }, (_, index) => granularity[index]!);
  let source: AsyncIterator<string> | undefined;
  let inputDone = false; let inputStopped = false; let done = false;
  const stopInput = () => {
    if (!source || inputDone || inputStopped) return; inputStopped = true;
    try { void Promise.resolve(source.return?.()).catch(() => {}); } catch {}
  };
  signal.addEventListener("abort", stopInput, { once: true });
  try {
    signal.throwIfAborted();
    connection.send({ path: "speech.config", requestId, body: JSON.stringify({ context: { system: { name: "speechswitch", version: "0.0.0", build: "JavaScript" } } }) });
    const input = markup === null ? {
      bidirectionalStreamingMode: true, voiceName: speech.voice, language: speech.language,
      ...(speech.pitch === null ? {} : { pitch: speech.pitch }), ...(speech.rate === null ? {} : { rate: speech.rate }),
      ...(speech.volume === null ? {} : { volume: speech.volume }), ...(speech.style === null ? {} : { style: speech.style }),
      ...(speech.temperature === null ? {} : { temperature: String(speech.temperature) }),
      ...(request.lexiconUrl === undefined ? {} : { customLexiconUrl: request.lexiconUrl }),
      ...(preferredLocales === null ? {} : { preferLocales: preferredLocales }),
    } : undefined;
    connection.send({ path: "synthesis.context", requestId, body: JSON.stringify({ synthesis: {
      audio: { outputFormat: format, metadataOptions: {
        wordBoundaryEnabled: requested.includes("word"), sentenceBoundaryEnabled: requested.includes("sentence"),
        punctuationBoundaryEnabled: false, bookmarkEnabled: requested.includes("ssml"), visemeEnabled: requested.includes("viseme"), sessionEndEnabled: true,
      } }, language: { autoDetection: false }, ...(input === undefined ? {} : { input }),
    } }) });
    if (markup !== null) { connection.send({ path: "ssml", requestId, body: markup }); inputDone = true; }
    else source = (request.text as AsyncIterable<string>)[Symbol.asyncIterator]();
    const nextInput = () => Promise.resolve().then(() => { signal.throwIfAborted(); return source!.next(); }).then(value => ({ kind: "input" as const, value }), error => ({ kind: "error" as const, error }));
    const nextOutput = () => connection.messages.next().then(value => ({ kind: "output" as const, value }), error => ({ kind: "error" as const, error }));
    let pendingInput = source ? nextInput() : undefined; let pendingOutput = nextOutput(); let preferInput = false;
    let streamId: string | undefined; let durationMs: number | undefined;
    for (;;) {
      signal.throwIfAborted();
      const item = await (pendingInput ? Promise.race(preferInput ? [pendingInput, pendingOutput] : [pendingOutput, pendingInput]) : pendingOutput);
      preferInput = !preferInput;
      if (item.kind === "error") throw item.error;
      if (item.kind === "input") {
        if (item.value.done) { inputDone = true; pendingInput = undefined; connection.send({ path: "text.end", requestId, body: "" }); }
        else { validateInput(item.value.value); connection.send({ path: "text.piece", requestId, body: item.value.value }); pendingInput = nextInput(); }
        continue;
      }
      if (item.value.done) throw new TypeError("Microsoft WebSocket closed before turn.end");
      const message = item.value.value;
      const identity = message.type === "unknown" ? message.frame.requestId : message.requestId;
      if (identity.toLowerCase() !== requestId) throw new TypeError("Microsoft returned an unexpected synthesis request ID");
      if (message.type === "response") {
        if (streamId !== undefined && streamId !== message.streamId) throw new TypeError("Microsoft changed the audio stream within a synthesis turn");
        streamId = message.streamId;
      } else if (message.type === "audio") {
        if (streamId === undefined || streamId.toLowerCase() !== message.streamId.toLowerCase()) throw new TypeError("Microsoft returned audio for an unexpected stream");
        if (message.audio.byteLength) yield requested.length ? { correlation: "timeline", correlationId: requestId, streamId, audio: message.audio, timestamps: [] } : message.audio;
      } else if (message.type === "metadata") {
        if (message.streamId !== undefined && (streamId === undefined || message.streamId.toLowerCase() !== streamId.toLowerCase())) throw new TypeError("Microsoft returned metadata for an unexpected stream");
        if (message.durationMs !== undefined) durationMs = message.durationMs;
        const timestamps = message.timestamps.filter(mark => requested.includes(mark.kind));
        if (requested.length && (timestamps.length || message.durationMs !== undefined)) yield {
          correlation: "timeline", correlationId: requestId, ...(streamId === undefined ? {} : { streamId }), timestamps,
          ...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
        };
      } else if (message.type === "turn.end") {
        if (!inputDone) throw new TypeError("Microsoft ended synthesis before text.end");
        done = true; yield { event: "done", requestId, ...(durationMs === undefined ? {} : { durationMs }) }; return;
      }
      pendingOutput = nextOutput();
    }
  } finally {
    signal.removeEventListener("abort", stopInput); stopInput();
    if (!done) { try { connection.send({ path: "synthesis.control", requestId, body: '{"action":"stop"}' }); } catch {} }
    connection.close();
  }
}

export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<SynthesisItem> {
  const validateInput = validateRequest(request);
  let preferredLocales: string | null = null;
  if (request.preferredLanguages !== undefined) {
    preferredLocales = "";
    for (let index = 0; index < request.preferredLanguages.length; index++) {
      const value = request.preferredLanguages[index]!;
      if (/[,\r\n]/.test(value)) throw new TypeError("Microsoft preferred languages cannot contain commas or line breaks");
      preferredLocales += (index ? "," : "") + value;
    }
  }
  const socketMode = typeof request.text !== "string" || request.timestampGranularity !== undefined || options.webSocket !== undefined || options.webSocketUrl !== undefined;
  if (socketMode && request.output?.format === "wav") throw new TypeError("Microsoft WAV output requires the REST transport");
  const environment = typeof process === "undefined" ? {} : process.env;
  const credentials = options.auth?.microsoft?.apiKey !== undefined || options.auth?.microsoft?.accessToken !== undefined
    ? options.auth.microsoft : { apiKey: environment.SPEECHSWITCH_MICROSOFT_API_KEY ?? environment.AZURE_SPEECH_KEY, accessToken: environment.SPEECHSWITCH_MICROSOFT_ACCESS_TOKEN };
  const apiKey = credentials.apiKey; const token = credentials.accessToken;
  const region = options.auth?.microsoft?.region ?? environment.SPEECHSWITCH_MICROSOFT_REGION ?? environment.AZURE_SPEECH_REGION;
  if (!apiKey && !token && !options.webSocket) throw new TypeError("Missing auth.microsoft.apiKey or auth.microsoft.accessToken configuration");
  if (!region && !options.baseUrl && !options.webSocketUrl && !options.webSocket) throw new TypeError("Missing auth.microsoft.region configuration");
  if (region !== undefined && !/^[a-z0-9-]+$/.test(region)) throw new TypeError("Invalid Microsoft Speech region");
  const baseUrl = options.baseUrl ?? `https://${region}.${options.deploymentId ? "voice" : "tts"}.speech.${region?.startsWith("china") ? "azure.cn" : region?.startsWith("usgov") ? "azure.us" : "microsoft.com"}`;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : apiKey ? { "Ocp-Apim-Subscription-Key": apiKey } : {};
  const format = outputFormat(request.output ?? { format: "pcm", sampleRateHz: 24000 });
  const speech = settings(request);
  const markup = typeof request.text !== "string" ? null : request.inputType === "ssml" ? request.text : ssml(request.text, speech);
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)) throw new TypeError("Microsoft timeoutMs must be an integer between 0 and 2147483647");
  const lifetime = new AbortController(); const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted(); if (timeoutMs === 0) throw new DOMException("Microsoft synthesis deadline expired", "TimeoutError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; }); void aborted.catch(() => {});
  const abort = () => rejectAbort(signal.reason); signal.addEventListener("abort", abort, { once: true });
  const timeout = timeoutMs === undefined ? undefined : setTimeout(() => lifetime.abort(new DOMException("Microsoft synthesis deadline expired", "TimeoutError")), timeoutMs);
  try {
    if (socketMode) {
      let socket = options.webSocket;
      if (!socket) {
        const url = new URL(options.webSocketUrl ?? baseUrl);
        if (!options.webSocketUrl) { url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = `${url.pathname.replace(/\/$/, "")}/${markup === null ? "cognitiveservices/websocket/v2" : "tts/cognitiveservices/websocket/v1"}`; }
        if (options.deploymentId !== undefined) url.searchParams.set("deploymentId", options.deploymentId);
        if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("Microsoft native WebSocket auth requires Node or Bun; supply an authenticated socket in browsers");
        const Constructor = globalThis.WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocketLike;
        if (!Constructor) throw new TypeError("This runtime does not provide WebSocket");
        socket = new Constructor(url.href, { headers: { ...headers, "X-ConnectionId": crypto.randomUUID().replaceAll("-", "") } });
      }
      yield* streaming(request, speech, markup, format, preferredLocales, socket, signal, validateInput); return;
    }
    const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/$/, "")}/cognitiveservices/v1`;
    if (options.deploymentId !== undefined) url.searchParams.set("deploymentId", options.deploymentId);
    const pending = fetch(url, { method: "POST", redirect: "error", headers: { ...headers, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": format, "User-Agent": "speechswitch" }, body: markup, signal });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, aborted]);
    try {
      if (!response.ok) {
        const decoder = new TextDecoder(); let message = "";
        if (response.body) for await (const chunk of bytes(response.body, signal, aborted)) { message += decoder.decode(chunk.subarray(0, 4096 - message.length), { stream: true }); if (message.length >= 4096) break; }
        message += decoder.decode();
        throw new MicrosoftError(`Microsoft synthesis failed (${response.status}): ${message}`, response.status, response.headers.get("retry-after"));
      }
      if (!response.body) throw new TypeError("Microsoft returned no audio stream");
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== undefined && !contentType.startsWith("audio/") && contentType !== "application/octet-stream") throw new TypeError("Microsoft returned a non-audio response");
      yield* bytes(response.body, signal, aborted);
    } finally { if (!response.body?.locked) void response.body?.cancel().catch(() => {}); }
  } finally { if (timeout !== undefined) clearTimeout(timeout); signal.removeEventListener("abort", abort); lifetime.abort(); }
}
