import { decodeBase64 } from "../../base64.ts";
import type { SseMessage } from "../../runtime/sse.ts";

export class MistralError extends Error {
  readonly statusCode: number;
  readonly body: string;
  readonly retryAfter: string | null;
  constructor(statusCode: number, body: string, retryAfter: string | null) {
    super(`Mistral synthesis failed (${statusCode})`); this.name = "MistralError";
    this.statusCode = statusCode; this.body = body; this.retryAfter = retryAfter;
  }
}
export interface PromptTokensDetails {
  readonly cachedTokens?: number;
  readonly audioTokens?: number;
  readonly messages?: readonly {
    readonly role: "system" | "user" | "assistant" | "tool";
    readonly totalTokens?: number | null;
    readonly truncated?: boolean;
    readonly usageCount?: number;
  }[];
}
export interface Usage {
  readonly promptTokens?: number;
  readonly completionTokens?: number | null;
  readonly totalTokens?: number;
  readonly promptAudioSeconds?: number | null;
  readonly requestCount?: number | null;
  readonly cachedTokens?: number | null;
  readonly promptTokensDetails?: PromptTokensDetails | null;
  /** Retain the separately documented singular legacy field without overriding its plural sibling. */
  readonly promptTokenDetails?: PromptTokensDetails | null;
  readonly completionTokensDetails?: { readonly reasoningTokens?: number } | null;
}
export type Packet = { readonly event: "audio"; readonly audio: Uint8Array } | { readonly event: "done"; readonly usage: Usage };
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Mistral returned an invalid response object");
  return value as Record<string, unknown>;
}
function count(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`Mistral returned invalid ${field}`);
  return value;
}
export function audioData(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError("Mistral returned invalid base64 audio");
  return decodeBase64(value);
}
function promptDetails(value: unknown): PromptTokensDetails {
  const details = object(value);
  if (details.messages !== undefined && !Array.isArray(details.messages)) throw new TypeError("Mistral returned invalid usage messages");
  return {
    ...(details.cached_tokens === undefined ? {} : { cachedTokens: count(details.cached_tokens, "cached_tokens") }),
    ...(details.audio_tokens === undefined ? {} : { audioTokens: count(details.audio_tokens, "audio_tokens") }),
    ...(details.messages === undefined ? {} : { messages: details.messages.map(raw => {
      const message = object(raw); const role = message.role;
      if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") throw new TypeError("Mistral returned invalid usage message role");
      if (message.truncated !== undefined && typeof message.truncated !== "boolean") throw new TypeError("Mistral returned invalid usage truncated flag");
      return { role, ...(message.total_tokens === undefined ? {} : { totalTokens: message.total_tokens === null ? null : count(message.total_tokens, "total_tokens") }),
        ...(message.truncated === undefined ? {} : { truncated: message.truncated as boolean }),
        ...(message.usage_count === undefined ? {} : { usageCount: count(message.usage_count, "usage_count") }) };
    }) }),
  };
}
export function decodeUsage(value: unknown): Usage {
  const usage = object(value);
  const result: { promptTokens?: number; completionTokens?: number | null; totalTokens?: number; promptAudioSeconds?: number | null; requestCount?: number | null; cachedTokens?: number | null } = {};
  for (const [native, normalized, nullable] of [
    ["prompt_tokens", "promptTokens", false], ["completion_tokens", "completionTokens", true], ["total_tokens", "totalTokens", false],
    ["prompt_audio_seconds", "promptAudioSeconds", true], ["request_count", "requestCount", true], ["num_cached_tokens", "cachedTokens", true],
  ] as const) {
    const item = usage[native]; if (item === undefined) continue;
    if (item === null && nullable) result[normalized] = null; else result[normalized] = count(item, native);
  }
  const completion = usage.completion_tokens_details;
  const details = completion === undefined || completion === null ? completion : object(completion);
  return { ...result,
    ...(usage.prompt_tokens_details === undefined ? {} : { promptTokensDetails: usage.prompt_tokens_details === null ? null : promptDetails(usage.prompt_tokens_details) }),
    ...(usage.prompt_token_details === undefined ? {} : { promptTokenDetails: usage.prompt_token_details === null ? null : promptDetails(usage.prompt_token_details) }),
    ...(details === undefined ? {} : { completionTokensDetails: details === null ? null : { ...(details.reasoning_tokens === undefined ? {} : { reasoningTokens: count(details.reasoning_tokens, "reasoning_tokens") }) } }),
  };
}
export function decodeJson(value: unknown): Uint8Array { return audioData(object(value).audio_data); }
export function decodeEvent(message: SseMessage): Packet {
  const data = object(JSON.parse(message.data));
  const type = data.type ?? message.event;
  if (message.event !== "message" && message.event !== type) throw new TypeError("Mistral returned conflicting SSE event types");
  if (type === "speech.audio.delta") return { event: "audio", audio: audioData(data.audio_data) };
  if (type === "speech.audio.done") return { event: "done", usage: decodeUsage(data.usage) };
  throw new TypeError("Mistral returned an unsupported speech event");
}
