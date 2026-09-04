import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { createVoice, deleteVoice, synthesize, synthesizeWithTimestamps, voices } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (typeof data !== "string") throw new TypeError("Expected JSON text");
    const value = JSON.parse(data) as { readonly close?: boolean };
    this.sent.push(value);
    if (value.close) queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify(audioEvent) });
      this.emit("message", { data: JSON.stringify(timestampEvent) });
      this.emit("close", {});
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

const audioEvent = {
  type: "audio",
  audio: "AQI=",
  audio_format: "mp3",
  chunk_index: 0,
  generation_id: "generation",
  is_last_chunk: true,
  request_id: "request",
  snippet_id: "snippet",
  text: "hello",
  transcribed_text: null,
  utterance_index: 0,
} as const;
const timestampEvent = {
  type: "timestamp",
  generation_id: "generation",
  request_id: "request",
  snippet_id: "snippet",
  timestamp: { text: "hello", time: { begin: 10, end: 300 }, type: "word" },
} as const;
const auth = { hume: { apiKey: "test-key" } } as const;
const baseRequest = {
  voice: "voice-id",
  voiceSource: "catalog",
  model: "octave-2",
  output: { format: "mp3" },
} as const;

describe("Hume", () => {
  test("supports flush only in Hume incremental input without widening Amazon", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string | { readonly command: "flush" }>
    >();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
  });

  test("uses byte-native HTTP file streaming for complete text", async () => {
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
      speed: 1.2,
      deliveryInstructions: "Warm and calm",
      trailingSilenceSeconds: 0.2,
      temperature: 0.7,
      continuityId: "previous-generation",
      latencyOptimization: "aggressive",
    }, { auth, fetch }))).toEqual([Uint8Array.of(3, 4)]);
    expect(url).toBe("https://api.hume.ai/v0/tts/stream/file");
    expect(new Headers(init?.headers).get("x-hume-api-key")).toBe("test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      context: { generation_id: "previous-generation" },
      format: { type: "mp3" },
      num_generations: 1,
      split_utterances: false,
      strip_headers: true,
      temperature: 0.7,
      utterances: [{
        text: "hello",
        description: "Warm and calm",
        speed: 1.2,
        trailing_silence: 0.2,
        voice: { id: "voice-id", provider: "HUME_AI" },
      }],
      version: "2",
      instant_mode: true,
    });
  });

  test("streams incremental input and flush over WebSocket", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize({
      ...baseRequest,
      text: (async function* () {
        yield "hello";
        yield { command: "flush" } as const;
      })(),
    }, { auth, webSocket: socket }))).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent).toEqual([
      { text: "hello", voice: { id: "voice-id", provider: "HUME_AI" } },
      { flush: true },
      { close: true },
    ]);
  });

  test("preserves independent JSON audio and timestamp events with their snippet ID", async () => {
    const response = `${JSON.stringify(audioEvent)}\n${JSON.stringify(timestampEvent)}\n`;
    const fetch: Fetch = async () => new Response(response);
    expect(await Array.fromAsync(synthesizeWithTimestamps({ ...baseRequest, text: "hello" }, {
      auth,
      fetch,
    }))).toEqual([
      {
        correlation: "timeline",
        correlationId: "snippet",
        audio: Uint8Array.of(1, 2),
        timestamps: [],
      },
      {
        correlation: "timeline",
        correlationId: "snippet",
        timestamps: [{ kind: "word", value: "hello", startTimeMs: 10, endTimeMs: 300 }],
      },
    ]);
  });

  test("lists, creates, and deletes custom voices", async () => {
    const requests: Array<{ readonly url: string; readonly method: string }> = [];
    const fetch: Fetch = async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      if (init?.method === "DELETE") return Response.json({});
      if (init?.method === "POST") return Response.json({
        id: "voice", name: "Mine", provider: "CUSTOM_VOICE",
      });
      return Response.json({ page_number: 0, page_size: 1, total_pages: 1, voices_page: [] });
    };
    await voices({ auth, fetch, voiceSource: "custom", pageSize: 1 });
    expect((await createVoice("generation", "Mine", { auth, fetch })).id).toBe("voice");
    await deleteVoice("Mine", { auth, fetch });
    expect(requests).toEqual([
      {
        url: "https://api.hume.ai/v0/tts/voices?provider=CUSTOM_VOICE&page_size=1",
        method: "GET",
      },
      { url: "https://api.hume.ai/v0/tts/voices", method: "POST" },
      { url: "https://api.hume.ai/v0/tts/voices?name=Mine", method: "DELETE" },
    ]);
  });
});
