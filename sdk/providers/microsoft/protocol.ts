import type { MicrosoftTimestamp } from "../../../schemas/providers/microsoft/index.ts";
export type { MicrosoftTimestamp } from "../../../schemas/providers/microsoft/index.ts";

// Azure's synthesis wire protocol is documented by the cataloged Speech SDK,
// not by its management TypeSpec. Audio bodies are bytes, never base64.
export interface ClientMessage {
  readonly path: "speech.config" | "synthesis.context" | "ssml" | "text.piece" | "text.end" | "synthesis.control";
  readonly requestId: string;
  readonly body: string;
}

interface FrameHeaders {
  readonly path: string;
  readonly requestId: string;
  readonly streamId?: string;
}
export type Frame =
  | (FrameHeaders & { readonly type: "text"; readonly body: string })
  | (FrameHeaders & { readonly type: "binary"; readonly body: Uint8Array });

export type ServerMessage =
  | { readonly type: "audio"; readonly requestId: string; readonly streamId: string; readonly audio: Uint8Array }
  | { readonly type: "metadata"; readonly requestId: string; readonly streamId?: string; readonly timestamps: readonly MicrosoftTimestamp[]; readonly durationMs?: number }
  | { readonly type: "response"; readonly requestId: string; readonly streamId: string }
  | { readonly type: "turn.start" | "turn.end"; readonly requestId: string }
  | { readonly type: "unknown"; readonly frame: Frame };

export function encodeMessage(message: ClientMessage, timestamp = new Date().toISOString()): string {
  if (!message.requestId || /[\r\n]/.test(message.requestId) || /[\r\n]/.test(timestamp)) {
    throw new TypeError("Invalid Microsoft synthesis message header");
  }
  const contentType = message.path === "ssml" ? "application/ssml+xml"
    : message.path === "text.piece" || message.path === "text.end" ? "text/plain" : "application/json";
  return `Path: ${message.path}\r\nX-RequestId: ${message.requestId}\r\nX-Timestamp: ${timestamp}\r\nContent-Type: ${contentType}\r\n\r\n${message.body}`;
}

export function decodeFrame(data: unknown): Frame {
  let rawHeaders: string;
  let body: string | Uint8Array;
  if (typeof data === "string") {
    const boundary = data.indexOf("\r\n\r\n");
    if (boundary < 0) throw new TypeError("Microsoft text frame is missing its header separator");
    rawHeaders = data.slice(0, boundary);
    // SSML/text bodies may themselves contain CRLF pairs.
    body = data.slice(boundary + 4);
  } else {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
      : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
    if (!bytes) throw new TypeError("Unsupported Microsoft WebSocket message data");
    if (bytes.byteLength < 2) throw new TypeError("Microsoft binary frame is missing its header length");
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, false);
    if (length > bytes.byteLength - 2) throw new TypeError("Microsoft binary frame has a truncated header");
    rawHeaders = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(2, length + 2));
    body = bytes.subarray(length + 2);
  }
  const headers = new Map<string, string>();
  for (const line of rawHeaders.split("\r\n")) {
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 1) throw new TypeError("Microsoft frame contains an invalid header");
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!/^[a-z0-9-]+$/.test(name) || /[\r\n]/.test(value)) throw new TypeError("Microsoft frame contains an invalid header");
    if (headers.has(name)) throw new TypeError(`Microsoft frame repeats header ${name}`);
    headers.set(name, value);
  }
  const path = headers.get("path");
  const requestId = headers.get("x-requestid");
  const streamId = headers.get("x-streamid");
  if (!path || !requestId) throw new TypeError("Microsoft frame is missing Path or X-RequestId");
  const identity = { path: path.toLowerCase(), requestId, ...(streamId === undefined ? {} : { streamId }) };
  return typeof body === "string" ? { ...identity, type: "text", body } : { ...identity, type: "binary", body };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Microsoft returned an invalid synthesis object");
  return value as Record<string, unknown>;
}

function ticks(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`Microsoft returned invalid ${name}`);
  return value / 10000;
}

export function decodeMessage(data: unknown): ServerMessage {
  const frame = decodeFrame(data);
  const requestId = frame.requestId;
  if (frame.path === "audio") {
    if (frame.type !== "binary" || !frame.streamId) throw new TypeError("Microsoft audio frame is missing binary audio or X-StreamId");
    return { type: "audio", requestId, streamId: frame.streamId, audio: frame.body };
  }
  if (frame.path === "turn.start" || frame.path === "turn.end") {
    if (frame.type !== "text") throw new TypeError("Microsoft turn event must be a text frame");
    return { type: frame.path, requestId };
  }
  if (frame.path !== "response" && frame.path !== "audio.metadata") return { type: "unknown", frame };
  if (frame.type !== "text") throw new TypeError("Microsoft synthesis metadata must be a text frame");
  const body = object(JSON.parse(frame.body));
  if (frame.path === "response") {
    const audio = object(body.audio);
    if (typeof audio.streamId !== "string" || !audio.streamId) throw new TypeError("Microsoft synthesis response is missing audio.streamId");
    return { type: "response", requestId, streamId: audio.streamId };
  }
  if (!Array.isArray(body.Metadata)) throw new TypeError("Microsoft returned invalid synthesis Metadata");
  const timestamps: MicrosoftTimestamp[] = [];
  let durationMs: number | undefined;
  for (const raw of body.Metadata) {
    const item = object(raw);
    if (typeof item.Type !== "string") throw new TypeError("Microsoft returned an invalid metadata type");
    // Future metadata kinds must not break ordinary speech synthesis.
    if (!["WordBoundary", "SentenceBoundary", "Bookmark", "Viseme", "SessionEnd"].includes(item.Type)) continue;
    const data = object(item.Data);
    const startTimeMs = ticks(data.Offset, "metadata Offset");
    if (item.Type === "SessionEnd") {
      if (durationMs !== undefined) throw new TypeError("Microsoft returned duplicate SessionEnd metadata");
      durationMs = startTimeMs;
    } else if (item.Type === "WordBoundary" || item.Type === "SentenceBoundary") {
      const text = object(data.text);
      if (typeof text.Text !== "string" || (text.BoundaryType !== undefined && typeof text.BoundaryType !== "string")) throw new TypeError("Microsoft returned invalid boundary text");
      const duration = ticks(data.Duration, "metadata Duration");
      if (!Number.isSafeInteger((data.Offset as number) + (data.Duration as number))) throw new TypeError("Microsoft metadata timing overflow");
      timestamps.push({ kind: item.Type === "WordBoundary" ? "word" : "sentence", value: text.Text,
        startTimeMs, endTimeMs: startTimeMs + duration,
        ...(text.BoundaryType === undefined ? {} : { boundaryType: text.BoundaryType }) });
    } else if (item.Type === "Bookmark") {
      if (typeof data.Bookmark !== "string") throw new TypeError("Microsoft returned an invalid bookmark");
      timestamps.push({ kind: "ssml", value: data.Bookmark, startTimeMs });
    } else {
      if (typeof data.VisemeId !== "number" || !Number.isSafeInteger(data.VisemeId) || data.VisemeId < 0
        || (data.AnimationChunk !== undefined && typeof data.AnimationChunk !== "string")
        || (data.IsLastAnimation !== undefined && typeof data.IsLastAnimation !== "boolean")) throw new TypeError("Microsoft returned invalid viseme metadata");
      timestamps.push({ kind: "viseme", value: String(data.VisemeId), startTimeMs,
        ...(data.AnimationChunk === undefined ? {} : { animationChunk: data.AnimationChunk }),
        ...(data.IsLastAnimation === undefined ? {} : { isLastAnimation: data.IsLastAnimation }) });
    }
  }
  return { type: "metadata", requestId, ...(frame.streamId === undefined ? {} : { streamId: frame.streamId }), timestamps,
    ...(durationMs === undefined ? {} : { durationMs }) };
}
