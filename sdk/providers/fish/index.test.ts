import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { decodeMessagePack, encodeMessagePack } from "../../runtime/msgpack.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, synthesizeWithTimestamps } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (typeof data === "string" || data instanceof Blob) throw new TypeError("Expected MessagePack");
    const value = decodeMessagePack(data) as { event: string };
    this.sent.push(value);
    if (value.event === "stop") queueMicrotask(() => {
      this.emit("message", { data: encodeMessagePack({ event: "audio", audio: Uint8Array.of(1, 2) }) });
      this.emit("message", { data: encodeMessagePack({ event: "finish", reason: "stop" }) });
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

const auth = { fish: { apiKey: "test-key" } } as const;
const baseRequest = {
  voice: "custom-model-id",
  model: "s2-pro",
  output: { format: "mp3", sampleRateHz: 44100, bitRateBps: 128000 },
} as const;

describe("Fish Audio", () => {
  test("keeps streaming controls provider-specific", () => {
    type AmazonText = Parameters<typeof amazonSynthesize>[0]["text"];
    type FishText = Parameters<typeof synthesize>[0]["text"];
    expectTypeOf<AmazonText>().toEqualTypeOf<string | AsyncIterable<string>>();
    expectTypeOf<FishText>().toEqualTypeOf<
      string | AsyncIterable<string | { readonly command: "flush" }>
    >();
  });

  test("streams byte-native HTTP audio for complete text", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(3, 4));
    };
    expect(await Array.fromAsync(synthesize({
      ...baseRequest,
      text: "hello",
      speed: 1.1,
      volumeDb: -2,
      loudnessNormalization: true,
      textNormalization: false,
      latencyOptimization: "aggressive",
    }, { auth, fetch }))).toEqual([Uint8Array.of(3, 4)]);
    expect(url).toBe("https://api.fish.audio/v1/tts");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("model")).toBe("s2-pro");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "hello",
      reference_id: "custom-model-id",
      prosody: { speed: 1.1, volume: -2, normalize_loudness: true },
      normalize: false,
      format: "mp3",
      sample_rate: 44100,
      mp3_bitrate: 128,
      latency: "low",
    });
  });

  test("uses MessagePack WebSocket text and flush events", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize({
      ...baseRequest,
      text: (async function* () {
        yield "hello";
        yield { command: "flush" } as const;
      })(),
    }, { auth, webSocket: socket }))).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent).toEqual([
      {
        event: "start",
        request: {
          text: "",
          reference_id: "custom-model-id",
          format: "mp3",
          sample_rate: 44100,
          mp3_bitrate: 128,
        },
      },
      { event: "text", text: "hello" },
      { event: "flush" },
      { event: "stop" },
    ]);
  });

  test("streams base64 SSE audio and publishes only final timeline timestamps", async () => {
    const events = [
      {
        audio_base64: "AQ==",
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: { segments: [{ text: "old", start: 0, end: 0.1 }] },
      },
      {
        audio_base64: "Ag==",
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: { segments: [{ text: "hello", start: 0, end: 0.2 }] },
      },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    const fetch: Fetch = async () => new Response(events, {
      headers: { "content-type": "text/event-stream" },
    });
    expect(await Array.fromAsync(synthesizeWithTimestamps({ ...baseRequest, text: "hello" }, {
      auth,
      fetch,
    }))).toEqual([
      { correlation: "timeline", audio: Uint8Array.of(1), timestamps: [] },
      { correlation: "timeline", audio: Uint8Array.of(2), timestamps: [] },
      {
        correlation: "timeline",
        timestamps: [{ kind: "word", value: "hello", startTimeMs: 0, endTimeMs: 200 }],
      },
    ]);
  });
});
