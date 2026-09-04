import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { models, synthesize, synthesizeWithTimestamps, voice, voices } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readonly readyState = 1;
  binaryType = "";
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Array<(event: any) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    if (typeof data !== "string") throw new TypeError("Expected JSON text");
    const value = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(value);
    if (value.cancel === true) queueMicrotask(() => {
      this.emit("message", { data: '{"interrupted":true}' });
    });
    if (value.close_socket === true) queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({
        audio: "AQI=", enc: "pcm_s16le", idx: 0, sr: 24000, samples: 2, chunk_id: 7,
      }) });
      this.emit("message", { data: JSON.stringify({
        word_timestamps: [{
          word: "hello", start_ms: 100, end_ms: 400, char_start: 0, char_end: 5, score: 0.98,
        }],
        chunk_id: 7,
      }) });
      this.emit("message", { data: '{"final":true}' });
      this.emit("message", { data: '{"session_closed":true}' });
      this.emit("close", {});
    });
  }

  close(): void {}

  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void): void {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
    if (type === "open") queueMicrotask(listener);
  }

  removeEventListener(type: "open" | "error" | "close", listener: (event: any) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener));
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const auth = { kugelaudio: { apiKey: "test-key" } } as const;
const baseRequest = {
  voice: "1071",
  model: "kugel-3",
  output: { format: "pcm", sampleRateHz: 24000 },
} as const;

describe("KugelAudio", () => {
  test("keeps clear and flush controls provider-specific", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<
        string | { readonly command: "clear" } | { readonly command: "flush" }
      >
    >();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
  });

  test("streams the native REST response and maps generation controls", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(1, 2));
    };
    expect(await Array.fromAsync(synthesize({
      ...baseRequest,
      text: "hello",
      language: "en",
      temperature: 0.3,
      guidanceScale: 1.8,
      maxOutputTokens: 512,
      speed: 1.1,
      textNormalization: true,
      dictionarySelection: { projectId: 42, dictionaryIds: [7, 9] },
      output: { format: "mulaw", sampleRateHz: 8000 },
    }, { auth, fetch }))).toEqual([Uint8Array.of(1, 2)]);
    expect(url).toBe("https://api.kugelaudio.com/v1/tts/generate");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "hello",
      voice_id: 1071,
      cfg_scale: 1.8,
      temperature: 0.3,
      max_new_tokens: 512,
      output_format: "ulaw_8000",
      language: "en",
      model_id: "kugel-3",
      normalize: true,
      project_id: 42,
      dictionary_ids: [7, 9],
      speed: 1.1,
    });
  });

  test("maps normalized clear and flush through the native WebSocket", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize({
      ...baseRequest,
      text: (async function* () {
        yield "first";
        yield { command: "clear" } as const;
        yield "second";
        yield { command: "flush" } as const;
      })(),
      streamingBuffer: { maxDelayMs: 250, characterThreshold: 500 },
    }, { auth, webSocket: socket }))).toEqual([
      { event: "clear" },
      Uint8Array.of(1, 2),
    ]);
    expect(socket.sent).toEqual([
      {
        voice_id: 1071,
        sample_rate: 24000,
        model_id: "kugel-3",
        flush_timeout_ms: 250,
        max_buffer_length: 500,
      },
      { text: "first" },
      { cancel: true },
      { text: "second" },
      { flush: true },
      { close_socket: true },
    ]);
  });

  test("correlates separate timestamp frames by native chunk id", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesizeWithTimestamps({
      ...baseRequest,
      text: "hello",
      timestampGranularity: "word",
    }, { auth, webSocket: socket }))).toEqual([
      {
        correlation: "ordered",
        correlationId: "7",
        audio: Uint8Array.of(1, 2),
        timestamps: [],
      },
      {
        correlation: "ordered",
        correlationId: "7",
        timestamps: [{
          kind: "word",
          value: "hello",
          startTimeMs: 100,
          endTimeMs: 400,
          source: { start: 0, end: 5 },
        }],
      },
    ]);
    expect(socket.sent[0]).toMatchObject({ word_timestamps: true });
  });

  test("lists catalog and caller voices plus models", async () => {
    const urls: string[] = [];
    const fetch: Fetch = async (input) => {
      urls.push(String(input));
      if (urls.length === 1) return Response.json({
        voices: [{ id: 1, voice_id: 1, name: "Mine" }], total: 1,
      });
      if (urls.length === 2) return Response.json({ id: 1, voice_id: 1, name: "Mine" });
      return Response.json({ models: [{ id: "kugel-3", model_id: "kugel-3", name: "Kugel 3" }] });
    };
    expect((await voices({ auth, fetch, limit: 10, offset: 20 })).voices).toHaveLength(1);
    expect((await voice("mine", { auth, fetch })).name).toBe("Mine");
    expect(await models({ auth, fetch })).toHaveLength(1);
    expect(urls).toEqual([
      "https://api.kugelaudio.com/v1/voices?limit=10&offset=20",
      "https://api.kugelaudio.com/v1/voices/mine",
      "https://api.kugelaudio.com/v1/models",
    ]);
  });
});
