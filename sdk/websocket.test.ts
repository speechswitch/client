import { describe, expect, test } from "bun:test";
import { connectWebSocket } from "./websocket.ts";
import type { WebSocketLike } from "./websocket.ts";

class FakeWebSocket implements WebSocketLike {
  readonly readyState = 1;
  binaryType = "blob";
  readonly sent: unknown[] = [];
  readonly closes: Array<{ readonly code?: number; readonly reason?: string }> = [];
  private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.emit("close", {});
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: (event: unknown) => void): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (...arguments_: any[]) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as (event?: unknown) => void);
    this.listeners.set(type, listeners);
    if (type === "open") queueMicrotask(() => listener());
  }

  removeEventListener(type: "open" | "error" | "close", listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

type ServerMessage =
  | { readonly type: "audio"; readonly data: ArrayBuffer }
  | { readonly type: "status"; readonly ready: boolean };

describe("WebSocket transport", () => {
  test("uses injected codecs for text and binary frames", async () => {
    const socket = new FakeWebSocket();
    const client = await connectWebSocket<{ readonly text: string }, ServerMessage, Record<string, never>>({
      url: "wss://example.invalid/stream",
      webSocket: () => socket,
      parameters: {},
      protocols: [],
      encode: JSON.stringify,
      decode: (data) => typeof data === "string"
        ? JSON.parse(data) as ServerMessage
        : { type: "audio", data: data as ArrayBuffer },
    });
    expect(socket.binaryType).toBe("arraybuffer");

    const bytes = Uint8Array.of(1, 2, 3).buffer;
    socket.emit("message", { data: bytes });
    socket.emit("message", { data: '{"type":"status","ready":true}' });
    expect((await client.messages.next()).value).toEqual({ type: "audio", data: bytes });
    expect((await client.messages.next()).value).toEqual({ type: "status", ready: true });

    client.send({ text: "hello" });
    expect(socket.sent).toEqual(['{"text":"hello"}']);
  });

  test("surfaces decoder failures without returning the raw frame", async () => {
    const socket = new FakeWebSocket();
    const failure = new TypeError("Invalid provider frame");
    const client = await connectWebSocket<string, never, Record<string, never>>({
      url: "wss://example.invalid/stream",
      webSocket: () => socket,
      parameters: {},
      protocols: [],
      encode: (message) => message,
      decode: () => { throw failure; },
    });
    const next = client.messages.next();
    socket.emit("message", { data: "not silently accepted" });
    await expect(next).rejects.toBe(failure);
    expect(socket.closes).toEqual([{ code: 1003, reason: "Unable to decode message" }]);
  });
});
