import type { WebSocketData, WebSocketLike } from "../sdk/websocket.ts";

export class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "blob";
  readonly sent: WebSocketData[] = [];
  closed = false;
  onSend?: (data: WebSocketData) => void;
  readonly closes: Array<{ readonly code?: number; readonly reason?: string }> = [];
  private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

  send(data: WebSocketData): void {
    this.sent.push(data);
    this.onSend?.(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.readyState = 3;
    this.closes.push({ code, reason });
    this.emit("close", {});
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: (event: unknown) => void): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (...arguments_: any[]) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as (event?: unknown) => void);
    this.listeners.set(type, listeners);
    if (type === "open") queueMicrotask(() => listener());
  }

  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
