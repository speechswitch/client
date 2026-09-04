import type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/typecast/index.ts";
import { createCustomVoice, defaultBaseUrl, deleteCustomVoice, getCustomVoices, getVoices, synthesize as requestSpeech, synthesizeComposed, synthesizeTimestamped, type ComposeSegment, type CustomVoice, type Model, type Output, type Prompt, type TimestampResponse, type TtsInput, type Voice } from "../../generated/clients/typecast.ts";
import type { Auth } from "../../auth.ts";
import { decodeBase64 } from "../../base64.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
export type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/typecast/index.ts";
export interface SynthesizeOptions { readonly auth?: Auth; readonly fetch?: Fetch; readonly baseUrl?: string; readonly signal?: AbortSignal }
function environment(): Record<string, string | undefined> { return typeof process === "undefined" ? {} : process.env; }
function apiKey(options: SynthesizeOptions): string { const value = options.auth?.typecast?.apiKey ?? environment().SPEECHSWITCH_TYPECAST_API_KEY ?? environment().TYPECAST_API_KEY; if (!value) throw new TypeError("Missing auth.typecast.apiKey configuration"); return value; }
function client(options: SynthesizeOptions) { return { apiKey: apiKey(options), fetch: options.fetch ?? globalThis.fetch, baseUrl: options.baseUrl ?? defaultBaseUrl, signal: options.signal }; }
interface Settings { readonly voice: string; readonly model: string; readonly language?: string; readonly output: { readonly format: string }; readonly speed?: number; readonly volumeScale?: number; readonly pitchSemitones?: number; readonly targetLoudnessLufs?: number; readonly emotion?: string; readonly emotionIntensity?: number; readonly surroundingContext?: { readonly previous?: string; readonly next?: string }; readonly randomSeed?: number }
function prompt(request: Settings): Prompt | undefined {
  if (request.model === "ssfm-v30" && request.surroundingContext) return { emotion_type: "smart", previous_text: request.surroundingContext.previous, next_text: request.surroundingContext.next };
  if (!request.emotion) return undefined;
  return request.model === "ssfm-v30" ? { emotion_type: "preset", emotion_preset: request.emotion, emotion_intensity: request.emotionIntensity } : { emotion_preset: request.emotion, emotion_intensity: request.emotionIntensity };
}
function output(request: Settings): Output { if (request.volumeScale !== undefined && request.targetLoudnessLufs !== undefined) throw new TypeError("Typecast volumeScale and targetLoudnessLufs are mutually exclusive"); return { audio_format: request.output.format as "wav" | "mp3", audio_tempo: request.speed, audio_pitch: request.pitchSemitones, volume: request.volumeScale === undefined ? undefined : request.volumeScale * 100, target_lufs: request.targetLoudnessLufs }; }
function input(request: Settings, text: string): TtsInput { return { voice_id: request.voice, text, model: request.model as Model, language: request.language, prompt: prompt(request), output: output(request), seed: request.randomSeed }; }
async function checked(response: Response): Promise<Response> { if (response.ok) return response; const detail = (await response.text()).trim(); throw new TypeError(`Typecast returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`); }
function composed(request: Extract<TtsRequest, { readonly segments: readonly unknown[] }>): ComposeSegment[] { return request.segments.map((segment) => "pauseSeconds" in segment ? { type: "pause", duration_seconds: segment.pauseSeconds } : { type: "tts", ...input(segment, segment.text) }); }
export async function* synthesize(request: TtsRequest, options: SynthesizeOptions = {}): AsyncIterableIterator<Uint8Array> {
  const response = "segments" in request && request.segments ? await synthesizeComposed(composed(request), client(options)) : await requestSpeech(input(request as Exclude<TtsRequest, { readonly segments: readonly unknown[] }>, request.text!), request.latencyOptimization !== "none", client(options));
  await checked(response); if (!response.body) throw new TypeError("Typecast returned no audio stream"); yield* response.body;
}
export async function* synthesizeWithTimestamps(request: TtsRequestWithTimestamps, options: SynthesizeOptions = {}): AsyncIterableIterator<SynthesisEnvelope<Timestamp<"word" | "character">>> {
  const response = await checked(await synthesizeTimestamped(input(request, request.text), request.timestampGranularity === "character" ? "char" : "word", client(options)));
  const value = await response.json() as TimestampResponse;
  const values = request.timestampGranularity === "character" ? value.characters : value.words;
  if (!Array.isArray(values)) throw new TypeError("Typecast returned no requested timestamps");
  yield { correlation: "chunk", audio: decodeBase64(value.audio), timestamps: values.map((item) => ({ kind: request.timestampGranularity === "character" ? "character" : "word", value: item.text, startTimeMs: item.start * 1000, endTimeMs: item.end * 1000 })) };
}
export interface VoiceFilters { readonly model?: "ssfm-v21" | "ssfm-v30"; readonly gender?: "male" | "female"; readonly age?: "child" | "teenager" | "young_adult" | "middle_age" | "elder"; readonly useCase?: string; readonly source?: "catalog" | "custom" }
export async function listVoices(filters: VoiceFilters = {}, options: SynthesizeOptions = {}): Promise<readonly Voice[]> { const query = new URLSearchParams(); if (filters.model) query.set("model", filters.model); if (filters.gender) query.set("gender", filters.gender); if (filters.age) query.set("age", filters.age); if (filters.useCase) query.set("use_cases", filters.useCase); if (filters.source) query.set("voice_type", filters.source === "catalog" ? "original" : "custom"); return (await checked(await getVoices(query, client(options)))).json() as Promise<readonly Voice[]>; }
export async function listCustomVoices(options: SynthesizeOptions = {}): Promise<readonly CustomVoice[]> { return (await checked(await getCustomVoices(client(options)))).json() as Promise<readonly CustomVoice[]>; }
export interface CreateVoiceRequest { readonly name: string; readonly model: "ssfm-v21" | "ssfm-v30"; readonly audio: Uint8Array; readonly mediaType: "audio/wav" | "audio/mpeg"; readonly quality?: "instant" | "professional"; readonly language?: string }
export async function createVoice(request: CreateVoiceRequest, options: SynthesizeOptions = {}): Promise<CustomVoice> { const professional = request.quality === "professional"; if (professional && !request.language) throw new TypeError("Typecast professional cloning requires language"); const bytes = new ArrayBuffer(request.audio.byteLength); new Uint8Array(bytes).set(request.audio); const form = new FormData(); form.set(professional ? "files" : "file", new Blob([bytes], { type: request.mediaType }), request.mediaType === "audio/wav" ? "voice.wav" : "voice.mp3"); form.set("name", request.name); form.set("model", request.model); if (request.language) form.set("language", request.language); return (await checked(await createCustomVoice(professional, form, client(options)))).json() as Promise<CustomVoice>; }
export async function deleteVoice(voiceId: string, options: SynthesizeOptions = {}): Promise<void> { await checked(await deleteCustomVoice(voiceId, client(options))); }
