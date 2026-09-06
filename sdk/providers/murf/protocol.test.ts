import { expect, test } from "bun:test";
import { audio, decodeGeneration, decodeSocket, MurfError } from "./protocol.ts";

test("Murf protocol retains final false and whole native bytes", () => {
  expect(decodeSocket(JSON.stringify({ context_id: "one", audio: "AP+A", final: false }))).toEqual({ contextId: "one", audio: Uint8Array.of(0, 255, 128), final: false });
  expect(decodeSocket(JSON.stringify({ context_id: "one", final: true }))).toEqual({ contextId: "one", final: true });
  expect(audio("")).toEqual(new Uint8Array());
});
test.each(["_bad", "a", "=AA=", "AQ", "AQ==\n", 1])( "Murf rejects invalid base64 %#", value => {
  expect(() => audio(value)).toThrow(new TypeError("Murf returned invalid base64 audio"));
});
test.each([
  [Uint8Array.of(1), "Murf returned a non-text WebSocket message"],
  ['{"context_id":null,"audio":"AQ=="}', "Murf returned audio or completion without the requested context ID"],
  ['{"context_id":"one","final":1}', "Murf returned an invalid final flag"],
  ['{"context_id":"one","ready":true}', "Murf returned an unsupported WebSocket message"],
] as const)("Murf rejects unusable socket envelopes %#", (value, message) => {
  expect(() => decodeSocket(value)).toThrow(new TypeError(message));
});
test("Murf socket errors retain the complete native body", () => {
  const body = '{"error":{"message":"concurrency exceeded"},"context_id":"one"}';
  expect(() => decodeSocket(body)).toThrow(new MurfError(null, body));
});
test("Murf word timing uses milliseconds without guessed source offsets", () => {
  expect(decodeGeneration({ audioFile: "https://files.invalid/audio", audioLengthInSeconds: 0.05, remainingCharacterCount: 0,
    wordDurations: [{ word: "Hi", startMs: 0, endMs: 50, sourceWordIndex: 100 }] }, true, false)).toEqual({ audioUrl: "https://files.invalid/audio", durationMs: 50, remainingCharacters: 0,
      timestamps: [{ kind: "word", value: "Hi", startTimeMs: 0, endTimeMs: 50 }] });
  expect(() => decodeGeneration({ audioLengthInSeconds: 1, remainingCharacterCount: 0, encodedAudio: "AQ==", wordDurations: [{ word: "Hi", startMs: 20, endMs: 10 }] }, true, true)).toThrow(new TypeError("Murf returned an invalid word duration"));
});
