import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, synthesizeWithTimestamps, voice, voices } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (typeof data !== "string") throw new TypeError("Expected JSON text");
    const value = JSON.parse(data) as { readonly type: string };
    this.sent.push(value);
    if (value.type === "setup") queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ type: "ready", request_id: "request" }) });
    });
    if (value.type === "end_of_stream") queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ type: "audio", audio: "AQI=" }) });
      this.emit("message", {
        data: JSON.stringify({ type: "text", text: "hello", start_s: 0.1, stop_s: 0.4 }),
      });
      this.emit("message", { data: JSON.stringify({ type: "end_of_stream" }) });
    });
  }
  close() {}
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
    if (type === "open") queueMicrotask(listener);
  }
  removeEventListener(type: "open" | "error" | "close", listener: (event: any) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener));
  }
  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const auth = { gradium: { apiKey: "test-key" } } as const;
const baseRequest = {
  voice: "custom-voice-id",
  model: "tts-beta",
  output: { format: "pcm", sampleRateHz: 16000 },
} as const;

describe("Gradium", () => {
  test("supports streaming input without widening Amazon", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
  });

  test("streams raw HTTP audio for complete text", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(3, 4));
    };
    expect(await Array.fromAsync(synthesize({ ...baseRequest, text: "hello" }, {
      auth,
      fetch,
    }))).toEqual([Uint8Array.of(3, 4)]);
    expect(url).toBe("https://api.gradium.ai/api/post/speech/tts");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "hello",
      voice_id: "custom-voice-id",
      model_name: "tts-beta",
      output_format: "pcm_16000",
      only_audio: true,
    });
  });

  test("waits for ready and streams JSON text over WebSocket", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize({
      ...baseRequest,
      text: (async function* () { yield "hello"; yield "world"; })(),
    }, { auth, webSocket: socket }))).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent).toEqual([
      {
        type: "setup",
        model_name: "tts-beta",
        voice_id: "custom-voice-id",
        output_format: "pcm_16000",
      },
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
      { type: "end_of_stream" },
    ]);
  });

  test("keeps audio and text timestamps on the independent timeline", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesizeWithTimestamps({ ...baseRequest, text: "hello" }, {
      auth,
      webSocket: socket,
    }))).toEqual([
      { correlation: "timeline", audio: Uint8Array.of(1, 2), timestamps: [] },
      {
        correlation: "timeline",
        timestamps: [{
          kind: "segment",
          value: "hello",
          startTimeMs: 100,
          endTimeMs: 400,
        }],
      },
    ]);
  });

  test("lists catalog and custom voices and fetches one voice", async () => {
    const urls: string[] = [];
    const fetch: Fetch = async (input) => {
      urls.push(String(input));
      return urls.length === 1
        ? Response.json([{ uid: "custom", name: "Mine", is_catalog: false, is_pro_clone: true }])
        : Response.json({ uid: "custom", name: "Mine", is_catalog: false, is_pro_clone: true });
    };
    expect(await voices({ auth, fetch, skip: 10, limit: 20 })).toHaveLength(1);
    expect((await voice("custom", { auth, fetch })).uid).toBe("custom");
    expect(urls).toEqual([
      "https://api.gradium.ai/api/voices/?skip=10&limit=20&include_catalog=true",
      "https://api.gradium.ai/api/voices/custom",
    ]);
  });
});
