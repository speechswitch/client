import { expect } from "expect";
import { describe, test } from "node:test";
import { connectWebSocket } from "./websocket.ts";
import { FakeWebSocket } from "../test-support/fake-websocket.ts";

type ServerMessage =
  | { readonly type: "audio"; readonly data: ArrayBuffer }
  | { readonly type: "status"; readonly ready: boolean };
type ClientMessage = { readonly text: string };

describe("WebSocket transport", () => {
  test("uses injected codecs for text and binary frames", async () => {
    const socket = new FakeWebSocket();
    const client = await connectWebSocket({
      socket,
      encode: (message: ClientMessage) => JSON.stringify(message),
      decode: (data): ServerMessage =>
        typeof data === "string"
          ? (JSON.parse(data) as ServerMessage)
          : { type: "audio", data: data as ArrayBuffer },
    });
    expect(socket.binaryType).toBe("arraybuffer");

    const bytes = Uint8Array.of(1, 2, 3).buffer;
    socket.emit("message", { data: bytes });
    socket.emit("message", { data: '{"type":"status","ready":true}' });
    expect((await client.messages.next()).value).toStrictEqual({ type: "audio", data: bytes });
    expect((await client.messages.next()).value).toStrictEqual({ type: "status", ready: true });

    client.send({ text: "hello" });
    expect(socket.sent).toStrictEqual(['{"text":"hello"}']);
  });

  test("surfaces decoder failures without returning the raw frame", async () => {
    const socket = new FakeWebSocket();
    const failure = new TypeError("Invalid provider frame");
    const client = await connectWebSocket({
      socket,
      encode: (message: string) => message,
      decode: (): never => {
        throw failure;
      },
    });
    const next = client.messages.next();
    socket.emit("message", { data: "not silently accepted" });
    await expect(next).rejects.toBe(failure);
    expect(socket.closes).toStrictEqual([{ code: 4000, reason: "Unable to decode message" }]);
  });

  test("drains queued messages in order after a remote close", async () => {
    const socket = new FakeWebSocket();
    const client = await connectWebSocket({ socket, encode: String, decode: Number });
    socket.emit("message", { data: "1" });
    socket.emit("message", { data: "2" });
    expect(await client.messages.next()).toStrictEqual({ value: 1, done: false });
    socket.emit("message", { data: "3" });
    socket.emit("close", {});
    expect(await Array.fromAsync(client.messages)).toStrictEqual([2, 3]);
  });

  test("rejects concurrent reads without losing the pending read", async () => {
    const socket = new FakeWebSocket();
    const client = await connectWebSocket({ socket, encode: String, decode: Number });
    const first = client.messages.next();
    await expect(client.messages.next()).rejects.toThrow(
      new TypeError("Concurrent WebSocket reads are not supported"),
    );
    socket.emit("message", { data: "1" });
    expect(await first).toStrictEqual({ value: 1, done: false });
    const next = client.messages.next();
    client.close();
    await expect(next).resolves.toStrictEqual({ value: undefined, done: true });
  });

  test("abort rejects pending and future reads with the original error", async () => {
    const socket = new FakeWebSocket();
    const controller = new AbortController();
    const client = await connectWebSocket({
      socket,
      signal: controller.signal,
      encode: String,
      decode: Number,
    });
    const next = client.messages.next();
    const error = new Error("cancelled");
    controller.abort(error);
    await expect(next).rejects.toBe(error);
    await expect(client.messages.next()).rejects.toBe(error);
    expect(() => client.send(1)).toThrow(error);
    expect(socket.closed).toBe(true);
  });
});
