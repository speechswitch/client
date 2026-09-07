import type { Timestamp } from "../../timestamps.ts";
import type { Usage } from "../../../schemas/providers/minimax/index.ts";
export type { Usage } from "../../../schemas/providers/minimax/index.ts";

export class MiniMaxError extends Error {
  readonly code: number | null;
  readonly statusCode: number | null;
  readonly retryAfter: string | null;
  constructor(message: string, code: number | null, statusCode: number | null, retryAfter: string | null = null) {
    super(message); this.name = "MiniMaxError"; this.code = code; this.statusCode = statusCode; this.retryAfter = retryAfter;
  }
}

export interface Packet {
  readonly event?: string;
  readonly audio?: Uint8Array;
  readonly status?: 1 | 2;
  readonly subtitleFile?: string;
  readonly final?: boolean;
  readonly sessionId?: string;
  readonly connectionId?: string;
  readonly traceId?: string;
  readonly code: number;
  readonly message: string;
  readonly usage?: Usage;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("MiniMax returned an invalid response object");
  return value as Record<string, unknown>;
}
function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`MiniMax returned invalid ${field}`);
  return value;
}
function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new TypeError(`MiniMax returned invalid ${field}`);
  return value;
}

/** MiniMax's wire audio is hexadecimal, not base64. */
export function decodeHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[a-fA-F0-9]*$/.test(value)) throw new TypeError("MiniMax returned invalid hex audio");
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function decodePacket(value: unknown): Packet {
  const packet = object(value);
  const base = packet.base_resp === undefined ? undefined : object(packet.base_resp);
  const code = base === undefined ? 0 : integer(base.status_code, "base_resp.status_code");
  const message = base?.status_msg === undefined ? "" : string(base.status_msg, "base_resp.status_msg");
  // Error packets may have null data or malformed/unavailable success metadata.
  // Preserve their actual error code rather than replacing it with an audio error.
  if (code !== 0) return { code, message,
    ...(packet.event === undefined ? {} : { event: string(packet.event, "event") }),
    ...(packet.trace_id === undefined ? {} : { traceId: string(packet.trace_id, "trace_id") }) };
  const data = packet.data === undefined || packet.data === null ? undefined : object(packet.data);
  if (data?.status !== undefined && data.status !== 1 && data.status !== 2) throw new TypeError("MiniMax returned invalid data.status");
  if (packet.is_final !== undefined && typeof packet.is_final !== "boolean") throw new TypeError("MiniMax returned invalid is_final");
  const extra = packet.extra_info === undefined || packet.extra_info === null ? undefined : object(packet.extra_info);
  let usage: Usage | undefined;
  if (extra !== undefined) {
    if (extra.invisible_character_ratio !== undefined && (typeof extra.invisible_character_ratio !== "number" || !Number.isFinite(extra.invisible_character_ratio) || extra.invisible_character_ratio < 0 || extra.invisible_character_ratio > 1)) throw new TypeError("MiniMax returned invalid invisible_character_ratio");
    usage = {
      ...(extra.audio_length === undefined ? {} : { durationMs: integer(extra.audio_length, "audio_length") }),
      ...(extra.audio_sample_rate === undefined ? {} : { sampleRateHz: integer(extra.audio_sample_rate, "audio_sample_rate") }),
      ...(extra.audio_size === undefined ? {} : { byteLength: integer(extra.audio_size, "audio_size") }),
      ...(extra.bitrate === undefined ? {} : { bitRateBps: integer(extra.bitrate, "bitrate") }),
      ...(extra.audio_channel === undefined ? {} : { channelCount: integer(extra.audio_channel, "audio_channel") }),
      ...(extra.usage_characters === undefined ? {} : { billedCharacters: integer(extra.usage_characters, "usage_characters") }),
      ...(extra.word_count === undefined ? {} : { wordCount: integer(extra.word_count, "word_count") }),
      ...(extra.invisible_character_ratio === undefined ? {} : { invalidCharacterRatio: extra.invisible_character_ratio as number }),
      ...(extra.audio_format === undefined ? {} : { format: string(extra.audio_format, "audio_format") }),
    };
  }
  return { code, message,
    ...(packet.event === undefined ? {} : { event: string(packet.event, "event") }),
    ...(data?.audio === undefined ? {} : { audio: decodeHex(string(data.audio, "data.audio")) }),
    ...(data?.status === undefined ? {} : { status: data.status }),
    ...(data?.subtitle_file === undefined ? {} : { subtitleFile: string(data.subtitle_file, "data.subtitle_file") }),
    ...(packet.is_final === undefined ? {} : { final: packet.is_final as boolean }),
    ...(packet.session_id === undefined ? {} : { sessionId: string(packet.session_id, "session_id") }),
    ...(packet.connect_id === undefined ? {} : { connectionId: string(packet.connect_id, "connect_id") }),
    ...(packet.trace_id === undefined ? {} : { traceId: string(packet.trace_id, "trace_id") }),
    ...(usage === undefined ? {} : { usage }),
  };
}

export function decodeSocketMessage(data: unknown): Packet {
  if (typeof data !== "string") throw new TypeError("MiniMax WebSocket messages must be JSON text");
  return decodePacket(JSON.parse(data));
}

/** First-party CLI documents a flat JSON array with millisecond time_begin/time_end. */
export function decodeSubtitles(value: unknown, kind: "word" | "sentence"): Timestamp<"word" | "sentence">[] {
  if (!Array.isArray(value)) throw new TypeError("MiniMax subtitles must be a JSON array");
  return value.map(raw => {
    const item = object(raw);
    const startTimeMs = item.time_begin; const endTimeMs = item.time_end;
    if (typeof startTimeMs !== "number" || !Number.isFinite(startTimeMs) || startTimeMs < 0) throw new TypeError("MiniMax returned invalid subtitle time_begin");
    if (typeof endTimeMs !== "number" || !Number.isFinite(endTimeMs) || endTimeMs < 0) throw new TypeError("MiniMax returned invalid subtitle time_end");
    if (endTimeMs < startTimeMs) throw new TypeError("MiniMax returned reversed subtitle timestamps");
    return { kind, value: string(item.text, "subtitle text"), startTimeMs, endTimeMs };
  });
}
