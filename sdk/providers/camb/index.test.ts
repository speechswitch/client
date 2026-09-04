import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { createVoice, listVoices, synthesize, synthesizeWithTimestamps } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();
  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    this.sent.push(String(data));
    if ((JSON.parse(String(data)) as { readonly type: string }).type === "text.done") queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ type: "session.ready", session_id: "session", run_id: 7, config: {} }) });
      this.emit("message", { data: JSON.stringify({ type: "segment.start", segment_id: 3, text: "hello", word_timestamps: [{ word: "hello", start: 0.1, end: 0.4 }] }) });
      this.emit("message", { data: Uint8Array.of(1, 2).buffer });
      this.emit("message", { data: Uint8Array.of(3).buffer });
      this.emit("message", { data: JSON.stringify({ type: "segment.done", segment_id: 3 }) });
      this.emit("message", { data: JSON.stringify({ type: "session.done" }) });
    });
  }
  close() {}
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) { const values = this.listeners.get(type) ?? []; values.push(listener); this.listeners.set(type, values); if (type === "open") queueMicrotask(listener); }
  removeEventListener(type: "open" | "error" | "close", listener: (event: any) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener)); }
  private emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

const auth = { camb: { apiKey: "key" } } as const;
function liveRequest() { return { text: (async function* () { yield "hel"; yield "lo"; })(), voice: "6460", voiceSource: "custom" as const, model: "mars8-flash" as const, language: "en-us", output: { format: "mp3" as const, sampleRateHz: 48000 }, speed: 1.2, audioEnhancement: true, referenceAudioEnhancement: true, accentPreservation: true, namedEntityPronunciationEnhancement: true, inferenceSteps: 15, streamingBuffer: { maxDelayMs: 2500 } }; }

describe("CAMB.AI TTS", () => {
  test("streams complete text from the lowest-latency REST operation", async () => {
    let url = ""; let body: any; let key = "";
    const fetch: Fetch = async (input, init) => { url = String(input); body = JSON.parse(String(init?.body)); key = new Headers(init?.headers).get("x-api-key") ?? ""; return new Response(Uint8Array.of(1)); };
    expect(await Array.fromAsync(synthesize({ text: "hello", voice: "6460", model: "mars8-pro", language: "en-us", output: { format: "pcm", sampleEncoding: "signed_integer_32", byteOrder: "big_endian", sampleRateHz: 48000 }, speed: 1.1 }, { auth, fetch }))).toEqual([Uint8Array.of(1)]);
    expect(url).toBe("https://client.camb.ai/apis/tts-stream");
    expect(key).toBe("key");
    expect(body).toMatchObject({ text: "hello", voice_id: 6460, speech_model: "mars-pro", output_configuration: { format: "pcm_s32be", sample_rate: 48000 }, voice_settings: { speaking_rate: 1.1 } });
  });

  test("streams live binary frames through the generated AsyncAPI codec", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize(liveRequest(), { auth, webSocket: socket }))).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3)]);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { type: "session.start", voice_id: 6460, language: "en-us", output_format: "mp3", sample_rate: 48000, idle_timeout: 2.5, enhance_named_entities_pronunciation: true, apply_enhancement: true, enhance_reference_audio_quality: true, maintain_source_accent: true, speaking_rate: 1.2, inference_steps: 15 },
      { type: "text.chunk", text: "hel", index: 0 },
      { type: "text.chunk", text: "lo", index: 1 },
      { type: "text.done" },
    ]);
  });

  test("buffers one native segment to keep its timestamps chunk-correlated", async () => {
    expect(await Array.fromAsync(synthesizeWithTimestamps({ ...liveRequest(), timestampGranularity: "word" }, { auth, webSocket: new FakeWebSocket() }))).toEqual([{ correlation: "chunk", audio: Uint8Array.of(1, 2, 3), timestamps: [{ kind: "word", value: "hello", startTimeMs: 100, endTimeMs: 400 }] }]);
  });

  test("does not claim clear or flush support", () => {
    type Text = Parameters<typeof synthesize>[0]["text"];
    expectTypeOf<Text>().toEqualTypeOf<string | AsyncIterable<string>>();
  });

  test("exposes catalog and custom voice operations", async () => {
    const calls: string[] = [];
    const fetch: Fetch = async (input) => { calls.push(String(input)); return String(input).endsWith("list-voices") ? Response.json([{ id: 6460, voice_name: "Voice" }]) : Response.json({ voice_id: 88 }); };
    expect(await listVoices({ auth, fetch })).toHaveLength(1);
    expect(await createVoice({ name: "Mine", gender: 1, audio: Uint8Array.of(1), mediaType: "audio/wav" }, { auth, fetch })).toBe(88);
    expect(calls).toEqual(["https://client.camb.ai/apis/list-voices", "https://client.camb.ai/apis/create-custom-voice"]);
  });
});
