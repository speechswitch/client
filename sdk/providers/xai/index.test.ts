import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as dispatchSynthesize } from "../../dispatch.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, synthesizeWithTimestamps, voice, voices } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    this.sent.push(String(data));
    const message = JSON.parse(String(data)) as { type: string };
    if (message.type === "text.clear") {
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({ type: "audio.clear" }),
      }));
    }
    if (message.type === "text.done") {
      queueMicrotask(() => {
        this.emit("message", { data: JSON.stringify({ type: "audio.delta", delta: "AQI=" }) });
        this.emit("message", { data: JSON.stringify({ type: "audio.done" }) });
      });
    }
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

const auth = { xai: { apiKey: "test-key" } } as const;

describe("xAI TTS", () => {
  test("narrows stream control and events by provider", () => {
    type AmazonText = Parameters<typeof amazonSynthesize>[0]["text"];
    type XaiText = Parameters<typeof synthesize>[0]["text"];
    expectTypeOf<AmazonText>().toEqualTypeOf<string | AsyncIterable<string>>();
    expectTypeOf<XaiText>().toEqualTypeOf<
      string | AsyncIterable<string | { readonly command: "clear" }>
    >();
    expectTypeOf<ReturnType<typeof amazonSynthesize>>().toEqualTypeOf<
      AsyncIterableIterator<Uint8Array>
    >();
    expectTypeOf<ReturnType<typeof synthesize>>().toEqualTypeOf<
      AsyncIterableIterator<Uint8Array | { readonly event: "clear" }>
    >();

    const amazon = dispatchSynthesize("amazon", {
      text: "hello",
      voice: "Joanna",
      output: { format: "mp3" },
    });
    const xai = dispatchSynthesize("xai", { text: "hello", language: "en" });
    expectTypeOf(amazon).toEqualTypeOf<AsyncIterableIterator<Uint8Array>>();
    expectTypeOf(xai).toEqualTypeOf<
      AsyncIterableIterator<Uint8Array | { readonly event: "clear" }>
    >();
  });

  test("uses byte-native REST synthesis for string input", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(1, 2, 3));
    };
    expect(await Array.fromAsync(synthesize({
      text: "hello",
      voice: "eve",
      model: "grok-tts",
      language: "en",
      output: { format: "mp3", sampleRateHz: 24000, bitRateBps: 128000 },
      speed: 1.1,
      textNormalization: true,
      replacements: [{ pattern: "xAI", replacement: "X A I" }],
    }, { auth, fetch }))).toEqual([Uint8Array.of(1, 2, 3)]);
    expect(url).toBe("https://api.x.ai/v1/tts");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "hello",
      voice_id: "eve",
      language: "en",
      output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 },
      text_normalization: true,
      speed: 1.1,
      replace: { xAI: "X A I" },
    });
  });

  test("uses WebSocket synthesis only for streaming input", async () => {
    const socket = new FakeWebSocket();
    const audio = await Array.fromAsync(synthesize({
      text: (async function* () { yield "hel"; yield "lo"; })(),
      language: "en",
    }, { auth, webSocket: socket }));
    expect(audio).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { type: "text.delta", delta: "hel" },
      { type: "text.delta", delta: "lo" },
      { type: "text.done" },
    ]);
  });

  test("passes clear commands through and yields clear events", async () => {
    const socket = new FakeWebSocket();
    const output = await Array.fromAsync(synthesize({
      text: (async function* () {
        yield "first";
        yield { command: "clear" } as const;
        yield "replacement";
      })(),
      language: "en",
    }, { auth, webSocket: socket }));

    expect(output).toEqual([{ event: "clear" }, Uint8Array.of(1, 2)]);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { type: "text.delta", delta: "first" },
      { type: "text.clear" },
      { type: "text.delta", delta: "replacement" },
      { type: "text.done" },
    ]);
  });

  test("preserves native character-to-audio chunk correlation", async () => {
    const fetch: Fetch = async () => Response.json({
      audio: "AwQ=",
      content_type: "audio/mpeg",
      duration: 0.2,
      audio_timestamps: {
        graph_chars: ["H", "i"],
        graph_times: [{ start: 0, end: 0.1 }, { start: 0.1, end: 0.2 }],
      },
    });
    expect(await Array.fromAsync(synthesizeWithTimestamps({ text: "Hi", language: "en" }, {
      auth,
      fetch,
    }))).toEqual([{
      correlation: "chunk",
      audio: Uint8Array.of(3, 4),
      timestamps: [
        { kind: "character", value: "H", startTimeMs: 0, endTimeMs: 100 },
        { kind: "character", value: "i", startTimeMs: 100, endTimeMs: 200 },
      ],
    }]);
  });

  test("exposes generated voice operations", async () => {
    const fetch: Fetch = async (input) => String(input).endsWith("/voices")
      ? Response.json({ voices: [{ voice_id: "eve", name: "Eve", language: "en" }] })
      : Response.json({ voice_id: "eve", name: "Eve", language: "en" });
    expect(await voices({ auth, fetch })).toHaveLength(1);
    expect(await voice("eve", { auth, fetch })).toMatchObject({ voice_id: "eve" });
  });
});
