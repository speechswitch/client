import { decodeBase64 } from "../../base64.ts";
import type { MurfTimestamp } from "../../../schemas/providers/murf/index.ts";

export class MurfError extends Error {
  readonly statusCode: number | null;
  readonly body: string;
  readonly retryAfter: string | null;
  constructor(statusCode: number | null, body: string, retryAfter: string | null = null) {
    super(statusCode === null ? "Murf WebSocket synthesis failed" : `Murf synthesis failed (${statusCode})`);
    this.name = "MurfError"; this.statusCode = statusCode; this.body = body; this.retryAfter = retryAfter;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Murf returned an invalid response object");
  return value as Record<string, unknown>;
}
export function audio(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError("Murf returned invalid base64 audio");
  return decodeBase64(value);
}
export interface Packet { readonly contextId: string; readonly audio?: Uint8Array; readonly final: boolean }
export function decodeSocket(data: unknown): Packet {
  if (typeof data !== "string") throw new TypeError("Murf returned a non-text WebSocket message");
  const value = object(JSON.parse(data));
  if (value.error !== undefined) throw new MurfError(null, data);
  if (typeof value.context_id !== "string" || !value.context_id) throw new TypeError("Murf returned audio or completion without the requested context ID");
  if (value.final !== undefined && typeof value.final !== "boolean") throw new TypeError("Murf returned an invalid final flag");
  if (value.audio === undefined && value.final === undefined) throw new TypeError("Murf returned an unsupported WebSocket message");
  return { contextId: value.context_id, final: value.final === true, ...(value.audio === undefined ? {} : { audio: audio(value.audio) }) };
}
export interface Generation {
  readonly audioUrl?: string;
  readonly audio?: Uint8Array;
  readonly durationMs: number;
  readonly remainingCharacters: number;
  readonly warning?: string;
  readonly timestamps: readonly MurfTimestamp[];
}
export function decodeGeneration(data: unknown, timestamps: boolean, inline: boolean): Generation {
  const value = object(data);
  if (typeof value.audioLengthInSeconds !== "number" || !Number.isFinite(value.audioLengthInSeconds * 1000) || value.audioLengthInSeconds < 0) throw new TypeError("Murf returned an invalid audio duration");
  if (typeof value.remainingCharacterCount !== "number" || !Number.isSafeInteger(value.remainingCharacterCount)) throw new TypeError("Murf returned an invalid remaining character count");
  if (value.warning !== undefined && typeof value.warning !== "string") throw new TypeError("Murf returned an invalid warning");
  if (timestamps && !Array.isArray(value.wordDurations)) throw new TypeError("Murf returned no word durations");
  const marks: MurfTimestamp[] = timestamps ? (value.wordDurations as unknown[]).map(raw => {
    const mark = object(raw);
    if (typeof mark.word !== "string" || typeof mark.startMs !== "number" || typeof mark.endMs !== "number" || !Number.isSafeInteger(mark.startMs) || !Number.isSafeInteger(mark.endMs) || mark.startMs < 0 || mark.endMs < mark.startMs) throw new TypeError("Murf returned an invalid word duration");
    return { kind: "word", value: mark.word, startTimeMs: mark.startMs, endTimeMs: mark.endMs };
  }) : [];
  if (!inline && (typeof value.audioFile !== "string" || !value.audioFile)) throw new TypeError("Murf returned no audio file URL");
  return { ...(inline ? { audio: audio(value.encodedAudio) } : { audioUrl: value.audioFile as string }),
    durationMs: value.audioLengthInSeconds * 1000, remainingCharacters: value.remainingCharacterCount,
    ...(value.warning === undefined ? {} : { warning: value.warning as string }), timestamps: marks };
}
