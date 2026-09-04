import { describe, expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest, TtsRequestWithTimestamps } from "../../../schemas/providers/cartesia/index.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize, synthesizeWithTimestamps } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readonly readyState = 1;
  binaryType = "blob";
  readonly sent: Record<string, unknown>[] = [];
  private readonly listeners = new Map<string, Set<(event?: any) => void>>();
  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    const message = JSON.parse(String(data)) as Record<string, unknown>;
    this.sent.push(message);
    if (message.continue === false) queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ type: "chunk", data: "AQI=", done: false, status_code: 206, step_time: 1, context_id: "turn" }) });
      this.emit("message", { data: JSON.stringify({ type: "done", done: true, status_code: 206, context_id: "turn" }) });
    });
  }
  close(): void { this.emit("close", {}); }
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: (event: unknown) => void): void;
  addEventListener(type: string, listener: (event?: any) => void): void {
    const values = this.listeners.get(type) ?? new Set(); values.add(listener); this.listeners.set(type, values);
    if (type === "open") queueMicrotask(listener);
  }
  removeEventListener(type: "open" | "error" | "close", listener: (event: unknown) => void): void { this.listeners.get(type)?.delete(listener); }
  private emit(type: string, event: unknown): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

const request = {
  voice: "voice-id",
  model: "sonic-3.5",
  language: "en",
  output: { format: "pcm", sampleRateHz: 24000, sampleEncoding: "signed_integer_16", byteOrder: "little_endian" },
} as const;

describe("Cartesia", () => {
  test("keeps static and streaming provider capabilities narrow", () => {
    expectTypeOf<TtsRequest>().toMatchTypeOf<{ readonly model: "sonic-3" | "sonic-3.5" }>();
    expectTypeOf<TtsRequestWithTimestamps["timestampGranularity"]>().toEqualTypeOf<"word" | "phoneme">();
  });

  test("streams the byte endpoint with versioned bearer authentication", async () => {
    let init: RequestInit | undefined;
    const fetch: Fetch = async (_input, value) => { init = value; return new Response(Uint8Array.of(3, 4)); };
    const audio = await Array.fromAsync(synthesize({ ...request, text: "hello" }, { auth: { cartesia: { apiKey: "key" } }, fetch }));
    expect(audio).toEqual([Uint8Array.of(3, 4)]);
    expect(init?.headers).toEqual({ authorization: "Bearer key", "cartesia-version": "2026-08-14", "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model_id: "sonic-3.5", transcript: "hello", voice: "voice-id", language: "en" });
  });

  test("maps incremental text, flush, clear, and completion to context messages", async () => {
    const socket = new FakeWebSocket();
    const text = (async function* () {
      yield "hello ";
      yield { command: "flush" } as const;
      yield { command: "clear" } as const;
      yield "again";
    })();
    const audio = await Array.fromAsync(synthesize({ ...request, text, continuityId: "turn", segmentation: "immediate" }, { webSocket: socket }));
    expect(audio).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent.map(({ transcript, continue: continued, flush, cancel, max_buffer_delay_ms }) => ({ transcript, continued, flush, cancel, max_buffer_delay_ms }))).toEqual([
      { transcript: "hello ", continued: true, flush: undefined, cancel: undefined, max_buffer_delay_ms: 0 },
      { transcript: "", continued: true, flush: true, cancel: undefined, max_buffer_delay_ms: 0 },
      { transcript: undefined, continued: undefined, flush: undefined, cancel: true, max_buffer_delay_ms: undefined },
      { transcript: "again", continued: true, flush: undefined, cancel: undefined, max_buffer_delay_ms: 0 },
      { transcript: "", continued: false, flush: undefined, cancel: undefined, max_buffer_delay_ms: 0 },
    ]);
  });

  test("keeps independent SSE audio and word timestamps on one native timeline", async () => {
    const encoder = new TextEncoder();
    const events = [
      { type: "chunk", done: false, data: "AQI=", step_time: 1, status_code: 206, context_id: "turn" },
      { type: "timestamps", done: false, status_code: 206, context_id: "turn", word_timestamps: { words: ["hello"], start: [0.1], end: [0.4] } },
      { type: "done", done: true, status_code: 206, context_id: "turn" },
    ];
    const fetch: Fetch = async () => new Response(encoder.encode(events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("")));
    const values = await Array.fromAsync(synthesizeWithTimestamps({ ...request, text: "hello", timestampGranularity: "word", continuityId: "turn" }, { auth: { cartesia: { accessToken: "token" } }, fetch }));
    expect(values).toEqual([
      { correlation: "timeline", correlationId: "turn", audio: Uint8Array.of(1, 2), timestamps: [] },
      { correlation: "timeline", correlationId: "turn", timestamps: [{ kind: "word", value: "hello", startTimeMs: 100, endTimeMs: 400 }] },
    ]);
  });

  test("surfaces structured HTTP errors", async () => {
    const fetch: Fetch = async () => Response.json({ error_code: "model_not_found", title: "Invalid model", message: "No such model", request_id: "request-1" }, { status: 400 });
    await expect(Array.fromAsync(synthesize({ ...request, text: "hello" }, { auth: { cartesia: { apiKey: "key" } }, fetch }))).rejects.toThrow("(model_not_found): Invalid model: No such model [request request-1]");
  });
});
