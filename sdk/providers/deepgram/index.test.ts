import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();
  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    this.sent.push(String(data));
    const message = JSON.parse(String(data)) as { type: string };
    if (message.type === "Clear") {
      queueMicrotask(() => this.emit("message", { data: JSON.stringify({ type: "Cleared", sequence_id: 1 }) }));
    }
    if (message.type === "Close") {
      queueMicrotask(() => {
        this.emit("message", { data: Uint8Array.of(1, 2).buffer });
        this.emit("close", {});
      });
    }
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

const auth = { deepgram: { apiKey: "test-key" } } as const;

describe("Deepgram", () => {
  test("keeps Amazon streaming types narrower", () => {
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string | { readonly command: "clear" }>
    >();
  });

  test("uses byte-native REST synthesis for string input", async () => {
    let url: URL | undefined;
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = new URL(String(input));
      init = request;
      return new Response(Uint8Array.of(1, 2));
    };
    expect(await Array.fromAsync(synthesize({
      text: "hello",
      voice: "thalia",
      model: "aura-2",
      language: "en",
      output: { format: "mp3", sampleRateHz: 22050, bitRateBps: 48000 },
      speed: 1.1,
    }, { auth, fetch }))).toEqual([Uint8Array.of(1, 2)]);
    expect(url?.href).toBe("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3&sample_rate=22050&bit_rate=48000&speed=1.1");
    expect(new Headers(init?.headers).get("authorization")).toBe("Token test-key");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "hello" });
  });

  test("rejects unavailable model, voice, and language combinations", async () => {
    const stream = synthesize({
      text: "hello",
      voice: "thalia",
      model: "aura-1",
      language: "en",
      output: { format: "mp3" },
    }, { auth, fetch: async () => new Response() });
    await expect(stream.next()).rejects.toThrow("Deepgram does not provide model aura-thalia-en");
  });

  test("streams text, clear control, clear events, and byte-native audio", async () => {
    const socket = new FakeWebSocket();
    const values = await Array.fromAsync(synthesize({
      text: (async function* () {
        yield "first";
        yield { command: "clear" } as const;
        yield "second";
      })(),
      voice: "asteria",
      model: "aura-1",
      language: "en",
      output: { format: "pcm", sampleRateHz: 24000 },
    }, { auth, webSocket: socket }));
    expect(values).toEqual([{ event: "clear" }, Uint8Array.of(1, 2)]);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { type: "Speak", text: "first" },
      { type: "Clear" },
      { type: "Speak", text: "second" },
      { type: "Close" },
    ]);
  });
});
