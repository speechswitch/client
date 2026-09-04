import { describe, expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest } from "../../../schemas/providers/inworld/index.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, synthesizeWithTimestamps } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readonly readyState = 1;
  binaryType = "";
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Array<(event: any) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    if (typeof data !== "string") throw new TypeError("Expected JSON text");
    const value = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(value);
    if (value.close_context) queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({
        result: {
          audioChunk: {
            audioContent: "AQI=",
            timestampInfo: {
              wordAlignment: {
                words: ["hello"],
                wordStartTimeSeconds: [0.1],
                wordEndTimeSeconds: [0.4],
                phoneticDetails: [{
                  wordIndex: 0,
                  phones: [{
                    phoneSymbol: "h",
                    startTimeSeconds: 0.1,
                    durationSeconds: 0.1,
                    visemeSymbol: "aei",
                  }],
                }],
              },
            },
            status: { code: 0 },
          },
        },
      }) });
      this.emit("message", { data: JSON.stringify({
        result: { contextClosed: {}, status: { code: 0 } },
      }) });
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

const auth = { inworld: { apiKey: "test-key" } } as const;
const baseRequest = {
  voice: "Dennis",
  model: "inworld-tts-2",
  output: { format: "pcm", sampleRateHz: 16000 },
} as const;

describe("Inworld", () => {
  test("narrows incremental commands without widening Amazon", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string | { readonly command: "flush" }>
    >();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();

    const valid: TtsRequest = {
      ...baseRequest,
      text: (async function* () { yield "hello"; })(),
      streamingBuffer: { automatic: true },
      deliveryVariation: "balanced",
    };
    expect(valid.model).toBe("inworld-tts-2");
    // @ts-expect-error WebSocket synthesis has no instruction field.
    const invalid: TtsRequest = {
      ...baseRequest,
      text: (async function* () { yield "hello"; })(),
      deliveryInstructions: "whisper",
    };
    expect(invalid.deliveryInstructions).toBe("whisper");
  });

  test("uses synchronous HTTP when latency optimization is disabled", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return Response.json({ audioContent: "AQI=" });
    };
    expect(await Array.fromAsync(synthesize({
      ...baseRequest,
      text: "hello",
      language: "en-US",
      deliveryInstructions: "warmly",
      deliveryVariation: "creative",
      textNormalization: true,
      audioEnhancement: true,
      contextTexts: ["Earlier"],
      latencyOptimization: "none",
    }, { auth, fetch }))).toEqual([Uint8Array.of(1, 2)]);
    expect(url).toBe("https://api.inworld.ai/tts/v1/voice");
    expect(new Headers(init?.headers).get("authorization")).toBe("Basic test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "hello",
      voiceId: "Dennis",
      audioConfig: { audioEncoding: "PCM", sampleRateHertz: 16000 },
      modelId: "inworld-tts-2",
      language: "en-US",
      deliveryMode: "CREATIVE",
      instruction: "warmly",
      applyTextNormalization: "ON",
      enhanceGeneration: true,
      synthesisContext: { previousRequests: [{ text: "Earlier" }] },
    });
  });

  test("streams newline-delimited HTTP results by default", async () => {
    let url = "";
    const fetch: Fetch = async (input) => {
      url = String(input);
      return new Response([
        '{"result":{"audioContent":"AQI="}}',
        '{"result":{"audioContent":"AwQ="}}',
        "",
      ].join("\n"));
    };
    expect(await Array.fromAsync(synthesize({ ...baseRequest, text: "hello" }, {
      auth,
      fetch,
    }))).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3, 4)]);
    expect(url).toBe("https://api.inworld.ai/tts/v1/voice:stream");
  });

  test("preserves synchronous character timestamps as chunk correlation", async () => {
    const fetch: Fetch = async () => Response.json({
      audioContent: "AQI=",
      timestampInfo: {
        characterAlignment: {
          characters: ["H"],
          characterStartTimeSeconds: [0.1],
          characterEndTimeSeconds: [0.2],
        },
      },
    });
    expect(await Array.fromAsync(synthesizeWithTimestamps({
      ...baseRequest,
      text: "Hello",
      timestampGranularity: "character",
      latencyOptimization: "none",
    }, { auth, fetch }))).toEqual([{
      correlation: "chunk",
      audio: Uint8Array.of(1, 2),
      timestamps: [{ kind: "character", value: "H", startTimeMs: 100, endTimeMs: 200 }],
    }]);
  });

  test("streams text and flush commands through the WebSocket contract", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize({
      ...baseRequest,
      text: (async function* () {
        yield "hello";
        yield { command: "flush" } as const;
        yield "world";
      })(),
      deliveryVariation: "stable",
      textNormalization: false,
      streamingBuffer: { maxDelayMs: 50, characterThreshold: 20, automatic: true },
      latencyOptimization: "aggressive",
    }, { auth, webSocket: socket }))).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent).toEqual([
      { create: {
        voiceId: "Dennis",
        modelId: "inworld-tts-2",
        audioConfig: { audioEncoding: "PCM", sampleRateHertz: 16000 },
        maxBufferDelayMs: 50,
        bufferCharThreshold: 20,
        applyTextNormalization: "OFF",
        autoMode: true,
        deliveryMode: "STABLE",
      } },
      { send_text: { text: "hello" } },
      { flush_context: {} },
      { send_text: { text: "world" } },
      { close_context: {} },
    ]);
  });

  test("keeps WebSocket word, phoneme, and viseme data on its audio chunk", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesizeWithTimestamps({
      ...baseRequest,
      text: (async function* () { yield "hello"; })(),
      timestampGranularity: "word",
    }, { auth, webSocket: socket }))).toEqual([{
      correlation: "chunk",
      audio: Uint8Array.of(1, 2),
      timestamps: [
        { kind: "word", value: "hello", startTimeMs: 100, endTimeMs: 400 },
        { kind: "phoneme", value: "h", startTimeMs: 100, endTimeMs: 200 },
        { kind: "viseme", value: "aei", startTimeMs: 100, endTimeMs: 200 },
      ],
    }]);
    expect(socket.sent[0]).toMatchObject({ create: {
      timestampType: "WORD",
      timestampTransportStrategy: "SYNC",
    } });
  });
});
