import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, synthesizeWithTimestamps, voice, voices } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    this.sent.push(String(data));
    const message = JSON.parse(String(data)) as { text: string };
    if (message.text === "") queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({
        audio: "AQI=",
        alignment: {
          chars: ["H", "i"],
          charStartTimesMs: [0, 50],
          charDurationsMs: [50, 60],
        },
      }) });
      this.emit("message", { data: JSON.stringify({ isFinal: true }) });
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

const auth = { elevenlabs: { apiKey: "test-key" } } as const;
const baseRequest = {
  voice: "voice-id",
  model: "flash-v2.5",
  output: { format: "mp3", sampleRateHz: 44100, bitRateBps: 128000 },
} as const;

describe("ElevenLabs", () => {
  test("keeps provider controls and Amazon input narrow", () => {
    type AmazonText = Parameters<typeof amazonSynthesize>[0]["text"];
    type ElevenLabsText = Parameters<typeof synthesize>[0]["text"];
    expectTypeOf<AmazonText>().toEqualTypeOf<string | AsyncIterable<string>>();
    expectTypeOf<ElevenLabsText>().toEqualTypeOf<
      string | AsyncIterable<string | { readonly command: "flush" }>
    >();
    expectTypeOf<ReturnType<typeof synthesize>>().toEqualTypeOf<AsyncIterableIterator<Uint8Array>>();
  });

  test("uses byte-native ordinary HTTP synthesis for complete text", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(1, 2, 3));
    };
    expect(await Array.fromAsync(synthesize({
      ...baseRequest,
      text: "hello",
      language: "en",
      speed: 1.1,
      textNormalization: false,
      voiceTuning: { stability: 0.4, similarity: 0.8, style: 0.2, speakerBoost: true },
    }, { auth, fetch }))).toEqual([Uint8Array.of(1, 2, 3)]);
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-id?output_format=mp3_44100_128");
    expect(new Headers(init?.headers).get("xi-api-key")).toBe("test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "hello",
      model_id: "eleven_flash_v2_5",
      language_code: "en",
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
        speed: 1.1,
      },
      apply_text_normalization: "off",
    });
  });

  test("streams incremental text and flush commands over the structured WebSocket", async () => {
    const socket = new FakeWebSocket();
    const output = await Array.fromAsync(synthesize({
      ...baseRequest,
      text: (async function* () {
        yield "Hello";
        yield { command: "flush" } as const;
        yield "world ";
      })(),
    }, { auth, webSocket: socket }));
    expect(output).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { text: " " },
      { text: "Hello " },
      { text: " ", flush: true },
      { text: "world " },
      { text: "" },
    ]);
  });

  test("uses streaming HTTP when latency is preferred", async () => {
    let url = "";
    const fetch: Fetch = async (input) => {
      url = String(input);
      return new Response(Uint8Array.of(1));
    };
    await Array.fromAsync(synthesize({
      ...baseRequest,
      text: "hello",
      latencyOptimization: "aggressive",
    }, { auth, fetch }));
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-id/stream?output_format=mp3_44100_128&optimize_streaming_latency=4",
    );
  });

  test("preserves HTTP character-to-audio correlation", async () => {
    const fetch: Fetch = async () => Response.json({
      audio_base64: "AwQ=",
      alignment: {
        characters: ["H", "i"],
        character_start_times_seconds: [0, 0.1],
        character_end_times_seconds: [0.1, 0.2],
      },
    });
    expect(await Array.fromAsync(synthesizeWithTimestamps({ ...baseRequest, text: "Hi" }, {
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

  test("preserves WebSocket character-to-audio chunk correlation", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesizeWithTimestamps({
      ...baseRequest,
      text: (async function* () { yield "Hi"; })(),
    }, { auth, webSocket: socket }))).toEqual([{
      correlation: "chunk",
      audio: Uint8Array.of(1, 2),
      timestamps: [
        { kind: "character", value: "H", startTimeMs: 0, endTimeMs: 50 },
        { kind: "character", value: "i", startTimeMs: 50, endTimeMs: 110 },
      ],
    }]);
  });

  test("exposes existing custom voices", async () => {
    const fetch: Fetch = async (input) => String(input).endsWith("/voices")
      ? Response.json({ voices: [{ voice_id: "custom", name: "Custom", category: "cloned", labels: {} }] })
      : Response.json({ voice_id: "custom", name: "Custom", category: "cloned", labels: {} });
    expect(await voices({ auth, fetch })).toHaveLength(1);
    expect(await voice("custom", { auth, fetch })).toMatchObject({ voice_id: "custom" });
  });
});
