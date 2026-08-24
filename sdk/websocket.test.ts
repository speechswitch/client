import { describe, expect, test } from "bun:test";
import { connectWebSocket } from "./websocket.ts";
import type { WebSocketLike } from "./websocket.ts";

class FakeWebSocket implements WebSocketLike {
  readonly readyState = 1;
  binaryType = "blob";
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    this.sent.push(data);
  }

  close(): void {
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

describe("WebSocket transport", () => {
  test("keeps binary frames binary and parses JSON frames", async () => {
    const socket = new FakeWebSocket();
    const client = await connectWebSocket<{ text: string }, { audio: string }>({
      url: "wss://example.invalid/stream",
      webSocket: () => socket,
    });
    expect(socket.binaryType).toBe("arraybuffer");

    const bytes = Uint8Array.of(1, 2, 3).buffer;
    socket.emit("message", { data: bytes });
    socket.emit("message", { data: '{"audio":"encoded-on-the-wire"}' });
    expect((await client.messages.next()).value).toBe(bytes);
    expect((await client.messages.next()).value).toEqual({ audio: "encoded-on-the-wire" });

    client.send({ text: "hello" });
    expect(socket.sent).toEqual(['{"text":"hello"}']);
  });
});
