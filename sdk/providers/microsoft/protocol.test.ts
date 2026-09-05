import { describe, expect, test } from "bun:test";
import { decodeFrame, decodeMessage, encodeMessage } from "./protocol.ts";

const requestId = "0123456789abcdef0123456789abcdef";
const timestamp = "2026-09-05T12:00:00.000Z";
function text(path: string, body = "", extraHeaders = ""): string {
  return `Path: ${path}\r\nX-RequestId: ${requestId}\r\n${extraHeaders}\r\n${body}`;
}
function binary(headers: string, body = new Uint8Array()): Uint8Array {
  const encoded = new TextEncoder().encode(headers);
  const result = new Uint8Array(2 + encoded.length + body.length);
  new DataView(result.buffer).setUint16(0, encoded.length, false);
  result.set(encoded, 2); result.set(body, 2 + encoded.length);
  return result;
}

describe("Microsoft synthesis framing", () => {
  test.each([
    ["speech.config", "application/json"], ["synthesis.context", "application/json"],
    ["ssml", "application/ssml+xml"], ["text.piece", "text/plain"],
    ["text.end", "text/plain"], ["synthesis.control", "application/json"],
  ] as const)("encodes %s with native headers", (path, contentType) => {
    expect(encodeMessage({ path, requestId, body: "hello\r\n\r\n世界" }, timestamp)).toBe(
      `Path: ${path}\r\nX-RequestId: ${requestId}\r\nX-Timestamp: ${timestamp}\r\nContent-Type: ${contentType}\r\n\r\nhello\r\n\r\n世界`,
    );
  });
  test("preserves text after every embedded separator", () => {
    expect(decodeFrame(text("text.piece", "a\r\n\r\nb\r\n\r\n"))).toEqual({ path: "text.piece", requestId, type: "text", body: "a\r\n\r\nb\r\n\r\n" });
  });
  test("preserves raw audio, byte offsets, and native stream identity", () => {
    const audio = new Uint8Array([0, 255, 128, 13, 10]);
    const frame = binary(`Path: Audio\r\nx-requestid: ${requestId}\r\nX-StreamId: stream-1\r\n`, audio);
    const padded = new Uint8Array(frame.length + 7); padded.set(frame, 3);
    const expected = { type: "audio", requestId, streamId: "stream-1", audio } as const;
    expect(decodeMessage(frame.buffer)).toEqual(expected);
    expect(decodeMessage(padded.subarray(3, frame.length + 3))).toEqual(expected);
    expect(decodeMessage(new DataView(padded.buffer, 3, frame.length))).toEqual(expected);
  });
  test("reads unsigned big-endian header lengths", () => {
    const headers = `Path: audio\r\nX-RequestId: ${requestId}\r\nX-StreamId: s\r\nX-Padding: ${"a".repeat(33000)}\r\n`;
    expect(decodeMessage(binary(headers))).toEqual({ type: "audio", requestId, streamId: "s", audio: new Uint8Array() });
  });
  test.each([
    ["Path: audio", "Microsoft text frame is missing its header separator"],
    ["Path: audio\r\n\r\n", "Microsoft frame is missing Path or X-RequestId"],
    [text("audio", "", "path: other\r\n"), "Microsoft frame repeats header path"],
    [text("audio", "", "Malformed\r\n"), "Microsoft frame contains an invalid header"],
    [new Uint8Array([0]), "Microsoft binary frame is missing its header length"],
    [new Uint8Array([0, 5, 1]), "Microsoft binary frame has a truncated header"],
    [42, "Unsupported Microsoft WebSocket message data"],
    [text("audio"), "Microsoft audio frame is missing binary audio or X-StreamId"],
    [binary(`Path: audio\r\nX-RequestId: ${requestId}\r\n`), "Microsoft audio frame is missing binary audio or X-StreamId"],
  ])("rejects malformed frame %# exactly", (data, message) => {
    expect(() => decodeMessage(data)).toThrow(new TypeError(message));
  });
  test("prevents header injection", () => {
    expect(() => encodeMessage({ path: "text.end", requestId: "x\r\nPath: other", body: "" }, timestamp)).toThrow(new TypeError("Invalid Microsoft synthesis message header"));
  });
  test("retains unknown frames for the session's forward-compatibility policy", () => {
    expect(decodeMessage(text("future.event", "{}"))).toEqual({ type: "unknown", frame: { path: "future.event", requestId, type: "text", body: "{}" } });
  });
});

describe("Microsoft synthesis metadata", () => {
  const metadata = (items: readonly unknown[]) => text("audio.metadata", JSON.stringify({ Metadata: items }));
  test("decodes response and turn identities", () => {
    expect(decodeMessage(text("response", '{"audio":{"streamId":"native-stream"}}'))).toEqual({ type: "response", requestId, streamId: "native-stream" });
    expect(decodeMessage(text("turn.start"))).toEqual({ type: "turn.start", requestId });
    expect(decodeMessage(text("turn.end"))).toEqual({ type: "turn.end", requestId });
  });
  test("converts native ticks without inventing source or audio-chunk offsets", () => {
    expect(decodeMessage(metadata([
      { Type: "WordBoundary", Data: { Offset: 1234000, Duration: 560000, text: { Text: "hello", Length: 5, BoundaryType: "Word" } } },
      { Type: "SentenceBoundary", Data: { Offset: 0, Duration: 2000000, text: { Text: "hello!" } } },
      { Type: "SessionEnd", Data: { Offset: 2100000 } },
    ]))).toEqual({ type: "metadata", requestId, timestamps: [
      { kind: "word", value: "hello", startTimeMs: 123.4, endTimeMs: 179.4, boundaryType: "Word" },
      { kind: "sentence", value: "hello!", startTimeMs: 0, endTimeMs: 200 },
    ], durationMs: 210 });
  });
  test("preserves native bookmarks and animation chunks", () => {
    expect(decodeMessage(metadata([
      { Type: "Bookmark", Data: { Offset: 15000, Bookmark: "cue" } },
      { Type: "Viseme", Data: { Offset: 16000, VisemeId: 4, AnimationChunk: "<svg>", IsLastAnimation: false } },
      { Type: "Viseme", Data: { Offset: 17000, VisemeId: 5, AnimationChunk: "</svg>", IsLastAnimation: true } },
      { Type: "FutureMetadata", Data: null },
    ]))).toEqual({ type: "metadata", requestId, timestamps: [
      { kind: "ssml", value: "cue", startTimeMs: 1.5 },
      { kind: "viseme", value: "4", startTimeMs: 1.6, animationChunk: "<svg>", isLastAnimation: false },
      { kind: "viseme", value: "5", startTimeMs: 1.7, animationChunk: "</svg>", isLastAnimation: true },
    ] });
  });
  test.each([
    [{ Type: "SessionEnd", Data: { Offset: -1 } }, "Microsoft returned invalid metadata Offset"],
    [{ Type: "SessionEnd", Data: { Offset: 1.5 } }, "Microsoft returned invalid metadata Offset"],
    [{ Type: "WordBoundary", Data: { Offset: 0, Duration: -1, text: { Text: "x" } } }, "Microsoft returned invalid metadata Duration"],
    [{ Type: "WordBoundary", Data: { Offset: 0, Duration: 1, text: { Text: 3 } } }, "Microsoft returned invalid boundary text"],
    [{ Type: "Bookmark", Data: { Offset: 0, Bookmark: null } }, "Microsoft returned an invalid bookmark"],
    [{ Type: "Viseme", Data: { Offset: 0, VisemeId: 2, AnimationChunk: [] } }, "Microsoft returned invalid viseme metadata"],
    [{ Type: "WordBoundary", Data: { Offset: Number.MAX_SAFE_INTEGER, Duration: 1, text: { Text: "x" } } }, "Microsoft metadata timing overflow"],
  ])("rejects malformed metadata %# exactly", (item, message) => {
    expect(() => decodeMessage(metadata([item]))).toThrow(new TypeError(message));
  });
  test("rejects missing response stream IDs and duplicate duration metadata", () => {
    expect(() => decodeMessage(text("response", '{"audio":{}}'))).toThrow(new TypeError("Microsoft synthesis response is missing audio.streamId"));
    expect(() => decodeMessage(metadata([{ Type: "SessionEnd", Data: { Offset: 0 } }, { Type: "SessionEnd", Data: { Offset: 1 } }]))).toThrow(new TypeError("Microsoft returned duplicate SessionEnd metadata"));
  });
});
