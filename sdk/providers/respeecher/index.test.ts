import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize, voices } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();
  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (typeof data !== "string") throw new TypeError("Expected JSON");
    const value = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(value);
    if (value.continue === false) queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ type: "chunk", data: "AQI=", context_id: value.context_id }) });
      this.emit("message", { data: JSON.stringify({ type: "done", context_id: value.context_id }) });
    });
  }
  close() {}
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) { const values = this.listeners.get(type) ?? []; values.push(listener); this.listeners.set(type, values); if (type === "open") queueMicrotask(listener); }
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener)); }
  private emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

const auth = { respeecher: { apiKey: "test-key" } } as const;
const common = { voice: "samantha", model: "realtime-tts", language: "en" } as const;

describe("Respeecher", () => {
  test("streams WAV bytes", async () => {
    let url = "";
    const fetch: Fetch = async (input) => { url = String(input); return new Response(Uint8Array.of(1)); };
    expect(await Array.fromAsync(synthesize({ ...common, text: "hello", output: { format: "wav", sampleRateHz: 22050 } }, { auth, fetch }))).toEqual([Uint8Array.of(1)]);
    expect(url).toBe("https://api.respeecher.com/v1/public/tts/en-rt/tts/bytes");
  });

  test("decodes JSONL raw PCM chunks", async () => {
    const fetch: Fetch = async () => new Response('{"type":"chunk","data":"AwQ="}\n');
    expect(await Array.fromAsync(synthesize({ ...common, text: "hello", output: { format: "pcm", sampleRateHz: 22050, sampleEncoding: "float_32" } }, { auth, fetch }))).toEqual([Uint8Array.of(3, 4)]);
  });

  test("streams text and maps clear to native cancellation", async () => {
    const socket = new FakeWebSocket();
    expect(await Array.fromAsync(synthesize({
      ...common,
      continuityId: "first",
      text: (async function* () { yield "discard"; yield { command: "clear" } as const; yield "hello "; yield "world"; })(),
      output: { format: "pcm", sampleRateHz: 22050, sampleEncoding: "signed_integer_16" },
    }, { auth, webSocket: socket }))).toEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent[0]).toEqual({ context_id: "first", cancel: true });
    expect(socket.sent.at(-1)).toMatchObject({ transcript: "world", continue: false });
  });

  test("lists voices by language server", async () => {
    let url = "";
    const fetch: Fetch = async (input) => { url = String(input); return Response.json([]); };
    expect(await voices({ language: "uk", auth, fetch })).toEqual([]);
    expect(url).toBe("https://api.respeecher.com/v1/public/tts/ua-rt/voices");
  });

  test("keeps cancellation unavailable to WAV requests", () => {
    type Request = Parameters<typeof synthesize>[0];
    expectTypeOf<Extract<Request, { readonly output: { readonly format: "wav" } }>["text"]>().toEqualTypeOf<string>();
  });
});
