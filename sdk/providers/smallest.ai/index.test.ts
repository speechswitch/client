import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize, synthesizeWithTimestamps } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1; binaryType = ""; sent: unknown[] = [];
  private readonly listeners = new Map<string, Array<(event: any) => void>>();
  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (typeof data !== "string") throw new TypeError();
    const value = JSON.parse(data); this.sent.push(value);
    if (value.flush || value.context_close) queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ status: "chunk", data: { audio: "AQI=" } }) });
      if (value.word_timestamps || this.sent.some((item: any) => item.word_timestamps)) this.emit("message", { data: JSON.stringify({ status: "word_timestamp", data: { id: 0, word: "hi", start: 0.1, end: 0.4 } }) });
      this.emit("message", { data: JSON.stringify({ status: "complete", external_request_id: value.request_id }) });
    });
  }
  close() {}
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) { const values = this.listeners.get(type) ?? []; values.push(listener); this.listeners.set(type, values); if (type === "open") queueMicrotask(listener); }
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener)); }
  private emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}
const auth = { "smallest.ai": { apiKey: "key" } } as const;

describe("Smallest.ai", () => {
  test("uses SSE by default and decodes audio events", async () => {
    let url = ""; let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => { url = String(input); init = request; return new Response("event: audio\ndata: {\"audio\":\"AQI=\",\"done\":false,\"status\":\"206\"}\n\ndata: {\"done\":true,\"status\":\"200\"}\n\n"); };
    const result = await Array.fromAsync(synthesize({ text: "hello", voice: "magnus", model: "lightning-v3.1", language: "en", output: { format: "pcm", sampleRateHz: 24000 }, latencyOptimization: "aggressive" }, { auth, fetch }));
    expect(result).toEqual([Uint8Array.of(1, 2)]);
    expect(url).toBe("https://api.smallest.ai/waves/v1/tts/live");
    expect(JSON.parse(String(init?.body))).toMatchObject({ voice_id: "magnus", model: "lightning_v3.1", output_format: "pcm", sample_rate: 24000 });
  });
  test("uses binary REST when latency optimization is disabled", async () => {
    let accept = ""; const fetch: Fetch = async (_input, init) => { accept = new Headers(init?.headers).get("accept") ?? ""; return new Response(Uint8Array.of(3)); };
    expect(await Array.fromAsync(synthesize({ text: "hello", voice: "meher", model: "lightning-v3.1-pro", output: { format: "wav", sampleRateHz: 44100 }, latencyOptimization: "none" }, { auth, fetch }))).toEqual([Uint8Array.of(3)]);
    expect(accept).toBe("audio/wav");
  });
  test("streams text and terminal flush through WebSocket", async () => {
    const webSocket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize({ text: (async function* () { yield "hello"; })(), voice: "magnus", model: "lightning-v3.1", output: { format: "pcm", sampleRateHz: 24000 }, streamingBuffer: { maxDelayMs: 100 } }, { auth, webSocket }))).toEqual([Uint8Array.of(1, 2)]);
    expect(webSocket.sent[0]).toMatchObject({ text: "hello", voice_id: "magnus", continue: true, max_buffer_flush_ms: 100 });
    expect(webSocket.sent[1]).toMatchObject({ text: "", flush: true });
  });
  test("keeps independent audio and word events on a timeline", async () => {
    const webSocket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesizeWithTimestamps({ text: (async function* () { yield "hi"; })(), voice: "meher", model: "lightning-v3.1", language: "en", output: { format: "pcm", sampleRateHz: 24000 }, timestampGranularity: "word" }, { auth, webSocket }))).toEqual([
      { correlation: "timeline", audio: Uint8Array.of(1, 2), timestamps: [] },
      { correlation: "timeline", timestamps: [{ kind: "word", value: "hi", startTimeMs: 100, endTimeMs: 400 }] },
    ]);
  });
  test("does not claim cancellation support", () => {
    type Request = Parameters<typeof synthesize>[0];
    type StreamingText = Extract<Request, { readonly text: AsyncIterable<unknown> }>["text"];
    expectTypeOf<StreamingText>().toEqualTypeOf<AsyncIterable<string | { readonly command: "flush" }>>();
  });
});
