import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, synthesizeWithTimestamps, voices } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();
  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (typeof data !== "string") throw new TypeError("Expected JSON");
    const value = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(value);
    if (value.end === true) queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ audio: "AQI=", context_id: value.context_id }) });
      this.emit("message", { data: JSON.stringify({ final: true, context_id: value.context_id }) });
    });
  }
  close() {}
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
    if (type === "open") queueMicrotask(listener);
  }
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener));
  }
  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const auth = { murf: { apiKey: "test-key" } } as const;
const base = {
  voice: "en-US-natalie",
  model: "falcon-2",
  output: { format: "pcm", sampleRateHz: 24000 },
} as const;

describe("Murf", () => {
  test("keeps WebSocket controls provider-specific", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>
    >();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
  });

  test("streams complete text through the HTTP endpoint", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(1));
    };
    expect(await Array.fromAsync(synthesize({ ...base, text: "hello", speed: 1.2 }, { auth, fetch })))
      .toEqual([Uint8Array.of(1)]);
    expect(url).toBe("https://global.api.murf.ai/v1/speech/stream");
    expect(new Headers(init?.headers).get("api-key")).toBe("test-key");
    expect(JSON.parse(String(init?.body)).rate).toBeCloseTo(20);
  });

  test("streams text, flush, and clear through the exact AsyncAPI messages", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize({
      ...base,
      continuityId: "turn",
      streamingBuffer: { characterThreshold: 40, maxDelayMs: 100 },
      text: (async function* () {
        yield "hello";
        yield { command: "clear" } as const;
        yield "again";
        yield { command: "flush" } as const;
      })(),
    }, { auth, webSocket: socket }))).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent).toEqual([
      { min_buffer_size: 40, max_buffer_delay_in_ms: 100 },
      { context_id: "turn", voice_config: { voice_id: "en-US-natalie" } },
      { text: "hello", context_id: "turn" },
      { clear: true, context_id: "turn" },
      { text: "again", context_id: "turn" },
      { text: "", context_id: "turn", end: true },
    ]);
  });

  test("keeps generated word timings and downloaded audio on one native timeline", async () => {
    const fetch: Fetch = async (input) => String(input).includes("/generate")
      ? Response.json({
          audioFile: "https://audio.example/result.wav",
          audioLengthInSeconds: 1,
          remainingCharacterCount: 10,
          wordDurations: [{ word: "hello", startMs: 10, endMs: 400 }],
        })
      : new Response(Uint8Array.of(3, 4));
    expect(await Array.fromAsync(synthesizeWithTimestamps({
      text: "hello",
      voice: "en-US-natalie",
      model: "gen2",
      output: { format: "wav", sampleRateHz: 24000 },
      timestampGranularity: "word",
    }, { auth, fetch }))).toEqual([
      { correlation: "timeline", timestamps: [{ kind: "word", value: "hello", startTimeMs: 10, endTimeMs: 400 }] },
      { correlation: "timeline", audio: Uint8Array.of(3, 4), timestamps: [] },
    ]);
  });

  test("lists voices by current model", async () => {
    let url = "";
    const fetch: Fetch = async (input) => { url = String(input); return Response.json([]); };
    expect(await voices({ auth, fetch, model: "falcon-2" })).toEqual([]);
    expect(url).toBe("https://global.api.murf.ai/v1/speech/voices?model=falcon-2");
  });
});
