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
    const message = JSON.parse(String(data)) as { readonly close_context?: boolean; readonly context_id?: string };
    if (message.close_context) queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ context_id: message.context_id, audio: "AQI=", final: false }) });
      this.emit("message", { data: JSON.stringify({ context_id: message.context_id, audio: "", final: true }) });
    });
  }
  close() {}
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) {
    const values = this.listeners.get(type) ?? []; values.push(listener); this.listeners.set(type, values);
    if (type === "open") queueMicrotask(listener);
  }
  removeEventListener(type: "open" | "error" | "close", listener: (event: any) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener)); }
  private emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

const auth = { async: { apiKey: "key" } } as const;

describe("Async TTS", () => {
  test("selects the HTTP stream and maps the catalog model", async () => {
    let url = ""; let body: any; let headers = new Headers();
    const fetch: Fetch = async (input, init) => { url = String(input); body = JSON.parse(String(init?.body)); headers = new Headers(init?.headers); return new Response(Uint8Array.of(1)); };
    expect(await Array.fromAsync(synthesize({ text: "hello", voice: "voice", voiceSource: "custom", model: "flash_v1.5", language: "fr", output: { format: "mp3", sampleRateHz: 44100, bitRateBps: 200000 }, latencyOptimization: "aggressive" }, { auth, fetch }))).toEqual([Uint8Array.of(1)]);
    expect(url).toBe("https://api.async.com/text_to_speech/streaming");
    expect(headers.get("x-api-key")).toBe("key");
    expect(headers.get("version")).toBe("v1");
    expect(body).toMatchObject({ model_id: "async_flash_v1.5", transcript: "hello", voice: { mode: "id", id: "voice" }, output_format: { container: "mp3", sample_rate: 44100, bit_rate: 200000 }, language: "fr" });
  });

  test("selects buffered HTTP and detects a fragmented streaming quota error", async () => {
    let url = "";
    const buffered: Fetch = async (input) => { url = String(input); return new Response(Uint8Array.of(7)); };
    expect(await Array.fromAsync(synthesize({ text: "hello", voice: "voice", model: "pro_v1.0", output: { format: "wav", sampleRateHz: 48000 }, latencyOptimization: "none" }, { auth, fetch: buffered }))).toEqual([Uint8Array.of(7)]);
    expect(url).toBe("https://api.async.com/text_to_speech");
    const quota: Fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("--ERROR:QUOTA_")); controller.enqueue(new TextEncoder().encode("EXCEEDED--")); controller.close(); } }));
    await expect(Array.fromAsync(synthesize({ text: "hello", voice: "voice", model: "pro_v1.0", output: { format: "mp3", sampleRateHz: 48000 } }, { auth, fetch: quota }))).rejects.toThrow("quota exceeded");
  });

  test("uses the explicit WebSocket message flow for incremental text", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize({ text: (async function* () { yield "hello"; yield "world "; })(), voice: "voice", model: "castleflow-1.0", output: { format: "mulaw", sampleRateHz: 8000 }, segmentation: "immediate" }, { auth, webSocket: socket, contextId: "context" }))).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { model_id: "async_flash_v1.0", voice: { mode: "id", id: "voice" }, output_format: { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 } },
      { context_id: "context", transcript: "hello ", force: true },
      { context_id: "context", transcript: "world ", force: true },
      { context_id: "context", transcript: "", close_context: true },
    ]);
  });

  test("preserves word timing with its audio", async () => {
    const fetch: Fetch = async () => Response.json({ audio_base64: "AwQ=", alignment: { words: ["hi"], word_start_times_milliseconds: [5], word_end_times_milliseconds: [15] } });
    expect(await Array.fromAsync(synthesizeWithTimestamps({ text: "hi", voice: "voice", model: "pro_v1.0", language: "en", output: { format: "wav", sampleRateHz: 44100 }, timestampGranularity: "word" }, { auth, fetch }))).toEqual([{ correlation: "chunk", audio: Uint8Array.of(3, 4), timestamps: [{ kind: "word", value: "hi", startTimeMs: 5, endTimeMs: 15 }] }]);
  });

  test("keeps unsupported stream commands out of the provider type", () => {
    type Text = Parameters<typeof synthesize>[0]["text"];
    expectTypeOf<Text>().toEqualTypeOf<string | AsyncIterable<string>>();
  });

  test("lists voices and creates a reusable custom voice", async () => {
    const calls: Array<{ readonly url: string; readonly body: BodyInit | null | undefined }> = [];
    const fetch: Fetch = async (input, init) => {
      calls.push({ url: String(input), body: init?.body });
      return String(input).endsWith("/voices")
        ? Response.json({ voices: [], next_cursor: "" })
        : Response.json({ id: "custom", name: "Mine", description: "", language: "en" });
    };
    expect(await listVoices({ my_voice: true }, { auth, fetch })).toEqual({ voices: [], next_cursor: "" });
    expect(await createVoice({ audio: Uint8Array.of(1), mediaType: "audio/wav", name: "Mine", audioEnhancement: true }, { auth, fetch })).toMatchObject({ id: "custom" });
    expect(calls.map(({ url }) => url)).toEqual(["https://api.async.com/voices", "https://api.async.com/voices/clone"]);
    expect(calls[1]?.body).toBeInstanceOf(FormData);
  });
});
