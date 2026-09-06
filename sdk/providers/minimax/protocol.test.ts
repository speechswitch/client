import { expect, test } from "bun:test";
import { decodeHex, decodePacket, decodeSocketMessage, decodeSubtitles } from "./protocol.ts";

test("MiniMax decodes hex bytes exactly, not base64", () => {
  expect(decodeHex("00aAfF8013")).toEqual(Uint8Array.of(0, 170, 255, 128, 19));
  expect(decodeHex("")).toEqual(new Uint8Array());
});
test.each(["0", "001", "0g", "0x01", "AA BB", "AA\n", "ＡＡ", "AQI="])("MiniMax rejects malformed hex %s", value => {
  let failure: unknown; try { decodeHex(value); } catch (error) { failure = error; }
  expect(failure).toEqual(new TypeError("MiniMax returned invalid hex audio"));
});
test("MiniMax retains audio, completion levels, and native identifiers separately", () => {
  expect(decodeSocketMessage(JSON.stringify({
    event: "task_continued", session_id: "session", connect_id: "connection", trace_id: "sentence-request",
    data: { audio: "00FF" }, is_final: true, base_resp: { status_code: 0, status_msg: "success" },
  }))).toEqual({ event: "task_continued", sessionId: "session", connectionId: "connection", traceId: "sentence-request",
    audio: Uint8Array.of(0, 255), final: true, code: 0, message: "success" });
  expect(decodeSocketMessage('{"event":"sentence_end","trace_id":"sentence-request"}')).toEqual({ event: "sentence_end", traceId: "sentence-request", code: 0, message: "" });
  expect(decodeSocketMessage('{"event":"task_finished"}')).toEqual({ event: "task_finished", code: 0, message: "" });
});
test("MiniMax accepts documented null data and missing event on audio examples", () => {
  expect(decodePacket({ data: null, base_resp: { status_code: 0 } })).toEqual({ code: 0, message: "" });
  expect(decodePacket({ data: { audio: "0102", status: 2 } })).toEqual({ code: 0, message: "", audio: Uint8Array.of(1, 2), status: 2 });
});
test("MiniMax failures preserve native error codes even when success payloads are unavailable", () => {
  expect(decodePacket({ event: "task_failed", data: null, extra_info: "unavailable", trace_id: "trace", base_resp: { status_code: 2205, status_msg: "queued too much" } })).toEqual({ event: "task_failed", traceId: "trace", code: 2205, message: "queued too much" });
});
test("MiniMax usage normalization preserves native units and zero", () => {
  expect(decodePacket({ extra_info: { audio_length: 10, audio_sample_rate: 32000, audio_size: 128,
    bitrate: 128000, audio_channel: 2, usage_characters: 0, word_count: 3, invisible_character_ratio: 0, audio_format: "opus" } })).toEqual({ code: 0, message: "", usage: {
      durationMs: 10, sampleRateHz: 32000, byteLength: 128, bitRateBps: 128000, channelCount: 2,
      billedCharacters: 0, wordCount: 3, invalidCharacterRatio: 0, format: "opus",
    } });
});
test.each([
  [null, "MiniMax returned an invalid response object"],
  [{ base_resp: { status_code: "0" } }, "MiniMax returned invalid base_resp.status_code"],
  [{ data: { status: 3 } }, "MiniMax returned invalid data.status"],
  [{ data: { audio: null } }, "MiniMax returned invalid data.audio"],
  [{ is_final: "true" }, "MiniMax returned invalid is_final"],
  [{ session_id: 1 }, "MiniMax returned invalid session_id"],
  [{ extra_info: { audio_length: 1.5 } }, "MiniMax returned invalid audio_length"],
  [{ extra_info: { invisible_character_ratio: 2 } }, "MiniMax returned invalid invisible_character_ratio"],
])("MiniMax rejects malformed native packet %#", (value, message) => {
  let failure: unknown; try { decodePacket(value); } catch (error) { failure = error; }
  expect(failure).toEqual(new TypeError(message));
});
test("MiniMax subtitles retain their independent file timeline without inventing source offsets", () => {
  expect(decodeSubtitles([{ text: "Hello", time_begin: 0, time_end: 250 }, { text: "World", time_begin: 250, time_end: 500 }], "sentence")).toEqual([
    { kind: "sentence", value: "Hello", startTimeMs: 0, endTimeMs: 250 }, { kind: "sentence", value: "World", startTimeMs: 250, endTimeMs: 500 },
  ]);
});
test.each([
  [{ subtitles: [] }, "MiniMax subtitles must be a JSON array"],
  [[{ text: "Hi", time_begin: -1, time_end: 10 }], "MiniMax returned invalid subtitle time_begin"],
  [[{ text: "Hi", time_begin: 10, time_end: 1 }], "MiniMax returned reversed subtitle timestamps"],
  [[{ text: null, time_begin: 0, time_end: 1 }], "MiniMax returned invalid subtitle text"],
])("MiniMax rejects malformed subtitle document %#", (value, message) => {
  let failure: unknown; try { decodeSubtitles(value, "word"); } catch (error) { failure = error; }
  expect(failure).toEqual(new TypeError(message));
});
