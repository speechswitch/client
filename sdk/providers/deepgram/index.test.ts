import { describe, expect, expectTypeOf, test } from "bun:test";
import assert from "node:assert/strict";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize } from "./index.ts";
import { validateRequest } from "../../generated/validators/deepgram.ts";
import type { TtsInput, TtsRequest } from "./index.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: string[] = [];
  closed = 0;
  constructor(private readonly onSend?: (message: { type: string; text?: string }, socket: FakeWebSocket) => void) {}
  private listeners = new Map<string, Array<(event: any) => void>>();
  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    this.sent.push(String(data));
    const message = JSON.parse(String(data)) as { type: string };
    if (this.onSend) { this.onSend(message, this); return; }
    if (message.type === "Clear") {
      queueMicrotask(() => this.emit("message", { data: JSON.stringify({ type: "Cleared", sequence_id: 1 }) }));
    }
    if (message.type === "Flush") {
      queueMicrotask(() => {
        this.emit("message", { data: Uint8Array.of(1, 2).buffer });
        this.emit("message", { data: JSON.stringify({ type: "Flushed", sequence_id: 2 }) });
      });
    }
  }
  close() { this.closed++; }
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
    if (type === "open") queueMicrotask(listener);
  }
  removeEventListener(type: "open" | "error" | "close", listener: (event: any) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener));
  }
  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const auth = { deepgram: { apiKey: "test-key" } } as const;
const common = { voice: "asteria", model: "aura-1", language: "en", output: { format: "pcm", sampleRateHz: 24000 } } as const;

describe("Deepgram", () => {
  test("keeps Amazon streaming types narrower", () => {
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>
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
    expect(url?.href).toBe("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3&bit_rate=48000&speed=1.1");
    expect(new Headers(init?.headers).get("authorization")).toBe("Token test-key");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "hello" });
  });

  test("rejects unavailable model, voice, and language combinations", async () => {
    // @ts-expect-error Voice availability narrows with model, before any network request.
    const stream = synthesize({
      text: "hello",
      voice: "thalia",
      model: "aura-1",
      language: "en",
      output: { format: "mp3" },
    }, { auth, fetch: async () => new Response() });
    await expect(stream.next()).rejects.toEqual(new TypeError("Invalid deepgram TTS request"));
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
    expect(values).toEqual([{ event: "clear", sequenceId: 1 }, Uint8Array.of(1, 2), { event: "done", sequenceId: 2 }]);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { type: "Speak", text: "first" },
      { type: "Clear" },
      { type: "Speak", text: "second" },
      { type: "Flush" },
      { type: "Close" },
    ]);
  });
});

test("explicit flush finishes an utterance without closing the connection", async () => {
  const socket = new FakeWebSocket();
  const result = await Array.fromAsync(synthesize({ ...common, text: (async function* () {
    yield "first"; yield { command: "flush" } as const; yield "second";
  })() }, { auth, webSocket: socket }));
  expect(socket.sent.map(value => JSON.parse(value))).toEqual([
    { type: "Speak", text: "first" }, { type: "Flush" }, { type: "Speak", text: "second" }, { type: "Flush" }, { type: "Close" },
  ]);
  expect(result).toEqual([Uint8Array.of(1, 2), { event: "done", sequenceId: 2 }, Uint8Array.of(1, 2), { event: "done", sequenceId: 2 }]);
  expect(socket.closed).toBe(1);
});

test("clear interrupts pending flush, discards stale audio, and waits before sending new text", async () => {
  let flushes = 0;
  const socket = new FakeWebSocket((message, socket) => {
    if (message.type === "Clear") {
      socket.emit("message", { data: Uint8Array.of(99).buffer });
      socket.emit("message", { data: JSON.stringify({ type: "Flushed", sequence_id: 0 }) });
      socket.emit("message", { data: JSON.stringify({ type: "Cleared", sequence_id: 1 }) });
    }
    if (message.type === "Flush" && ++flushes === 2) {
      socket.emit("message", { data: Uint8Array.of(2).buffer });
      socket.emit("message", { data: JSON.stringify({ type: "Flushed", sequence_id: 2 }) });
    }
  });
  const result = await Array.fromAsync(synthesize({ ...common, text: (async function* () {
    yield "old"; yield { command: "flush" } as const; yield { command: "clear" } as const; yield "new";
  })() }, { auth, webSocket: socket }));
  expect(result).toEqual([{ event: "clear", sequenceId: 1 }, Uint8Array.of(2), { event: "done", sequenceId: 2 }]);
  expect(socket.sent.map(value => JSON.parse(value))).toEqual([
    { type: "Speak", text: "old" }, { type: "Flush" }, { type: "Clear" }, { type: "Speak", text: "new" }, { type: "Flush" }, { type: "Close" },
  ]);
});

test("empty input and redundant empty flush finish without waiting for an audio acknowledgement", async () => {
  const socket = new FakeWebSocket();
  expect(await Array.fromAsync(synthesize({ ...common, text: (async function* () {
    yield ""; yield { command: "flush" } as const;
  })() }, { auth, webSocket: socket }))).toEqual([]);
  expect(socket.sent).toEqual(['{"type":"Close"}']);
  expect(socket.closed).toBe(1);
});

test("consumer cancellation closes the socket and returns stalled input without waiting for its return promise", async () => {
  let reads = 0;
  let returns = 0;
  const text: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({
    next: async () => ++reads === 1 ? { done: false, value: "hello" } : new Promise(() => {}),
    return: () => { returns++; return new Promise(() => {}); },
  }) };
  const socket = new FakeWebSocket((message, socket) => {
    if (message.type === "Speak") socket.emit("message", { data: Uint8Array.of(1).buffer });
  });
  const stream = synthesize({ ...common, text }, { auth, webSocket: socket });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  expect(await stream.return!(undefined)).toEqual({ done: true, value: undefined });
  expect(returns).toBe(1);
  expect(socket.closed).toBe(1);
});

test("abort rejects pending reads and cleans up a stalled input source", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let returns = 0;
  const text: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({
    next: () => { started(); return new Promise(() => {}); },
    return: async () => { returns++; return { done: true, value: undefined }; },
  }) };
  const socket = new FakeWebSocket();
  const promise = Array.fromAsync(synthesize({ ...common, text }, { auth, webSocket: socket, signal: controller.signal }));
  await reading;
  const reason = new Error("caller cancelled");
  controller.abort(reason);
  await expect(promise).rejects.toEqual(reason);
  expect(returns).toBe(1);
  expect(socket.closed).toBe(1);
});

test("input failure propagates even when the server has no pending response", async () => {
  const reason = new Error("input failed");
  const socket = new FakeWebSocket();
  await expect(Array.fromAsync(synthesize({ ...common, text: (async function* () {
    yield "hello"; throw reason;
  })() }, { auth, webSocket: socket }))).rejects.toEqual(reason);
  expect(socket.closed).toBe(1);
});

test("a rate-limit warning rejects synthesis instead of waiting for a missing flush ACK", async () => {
  const socket = new FakeWebSocket((message, socket) => {
    if (message.type === "Flush") socket.emit("message", { data: JSON.stringify({ type: "Warning", code: "FLUSH_LIMIT", description: "Try later" }) });
  });
  await expect(Array.fromAsync(synthesize({ ...common, text: (async function* () { yield "hello"; })() }, { auth, webSocket: socket })))
    .rejects.toEqual(new TypeError("Deepgram Warning FLUSH_LIMIT: Try later"));
  expect(socket.closed).toBe(1);
});

test("malformed acknowledgements are rejected by the handwritten wire decoder", async () => {
  const socket = new FakeWebSocket((message, socket) => {
    if (message.type === "Flush") socket.emit("message", { data: JSON.stringify({ type: "Flushed", sequence_id: "0" }) });
  });
  await expect(Array.fromAsync(synthesize({ ...common, text: (async function* () { yield "hello"; })() }, { auth, webSocket: socket })))
    .rejects.toEqual(new TypeError("Deepgram returned an invalid WebSocket event"));
  expect(socket.closed).toBe(1);
});

test("premature remote closure returns the input source and fails the unfinished synthesis", async () => {
  let returned = false;
  let reads = 0;
  const text: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({
    next: async () => ++reads === 1 ? { done: false, value: "hello" } : new Promise(() => {}),
    return: async () => { returned = true; return { done: true, value: undefined }; },
  }) };
  const socket = new FakeWebSocket((_message, socket) => socket.emit("close", {}));
  await expect(Array.fromAsync(synthesize({ ...common, text }, { auth, webSocket: socket })))
    .rejects.toEqual(new TypeError("Deepgram WebSocket closed before input or pending synthesis completed"));
  expect(returned).toBe(true);
});

test("REST cancellation cancels the byte stream without collecting it", async () => {
  let cancelled = false;
  const stream = synthesize({ ...common, text: "hello" }, { auth, fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.of(1)); },
    cancel() { cancelled = true; },
  })) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  await stream.return!(undefined);
  expect(cancelled).toBe(true);
});

test("usage tags and the explicit model-improvement choice reach HTTP without changing defaults", async () => {
  let query: [string, string][] = [];
  await Array.fromAsync(synthesize({ ...common, text: "hello", tags: ["one", "two"], modelImprovementOptOut: false }, {
    auth, fetch: async url => { query = [...new URL(String(url)).searchParams]; return new Response(Uint8Array.of(1)); },
  }));
  expect(query).toEqual([
    ["model", "aura-asteria-en"], ["encoding", "linear16"], ["container", "none"], ["sample_rate", "24000"],
    ["mip_opt_out", "false"], ["tag", "one"], ["tag", "two"],
  ]);
});

test("an already aborted signal prevents both HTTP and input consumption", async () => {
  const reason = new Error("already cancelled");
  let touched = false;
  const signal = AbortSignal.abort(reason);
  await expect(Array.fromAsync(synthesize({ ...common, text: "hello" }, { auth, signal, fetch: async () => {
    touched = true; return new Response();
  } }))).rejects.toEqual(reason);
  await expect(Array.fromAsync(synthesize({ ...common, text: (async function* () { touched = true; yield "hello"; })() },
    { auth, signal, webSocket: new FakeWebSocket() }))).rejects.toEqual(reason);
  expect(touched).toBe(false);
});

test("generated request checks reject voice/model/language mismatches and output bounds", () => {
  assert.throws(() => validateRequest({ ...common, text: "hello", voice: "thalia" }), { name: "TypeError", message: "Invalid deepgram TTS request" });
  assert.throws(() => validateRequest({ ...common, text: "hello", language: "de" }), { name: "TypeError", message: "Invalid deepgram TTS request" });
  assert.throws(() => validateRequest({ ...common, text: "hello", output: { format: "flac", bitRateBps: 48000 } }), { name: "TypeError", message: "Invalid deepgram TTS request" });
  assert.throws(() => validateRequest({ ...common, text: "hello", output: { format: "ogg_opus", bitRateBps: 650001 } }), { name: "TypeError", message: "Invalid deepgram TTS request" });
  assert.throws(() => validateRequest({ ...common, text: "hello", output: { format: "aac", bitRateBps: 3999 } }), { name: "TypeError", message: "Invalid deepgram TTS request" });
});

test("generated input checks reject unsupported stream commands before sending them", async () => {
  const socket = new FakeWebSocket();
  const text = (async function* () { yield { command: "update" }; })() as AsyncIterable<TtsInput>;
  await expect(Array.fromAsync(synthesize({ ...common, text }, { auth, webSocket: socket })))
    .rejects.toEqual(new TypeError("Invalid deepgram TTS input item"));
  expect(socket.sent).toEqual([]);
});

test("REST sends raw G.711, configurable FLAC rates, Opus bitrate, and WAV sample encoding", async () => {
  const cases: readonly { output: TtsRequest["output"]; query: string }[] = [
    { output: { format: "mulaw", sampleRateHz: 8000 }, query: "encoding=mulaw&container=none&sample_rate=8000" },
    { output: { format: "alaw", sampleRateHz: 16000 }, query: "encoding=alaw&container=none&sample_rate=16000" },
    { output: { format: "flac", sampleRateHz: 22050 }, query: "encoding=flac&sample_rate=22050" },
    { output: { format: "ogg_opus", sampleRateHz: 48000, bitRateBps: 650000 }, query: "encoding=opus&container=ogg&bit_rate=650000" },
    { output: { format: "aac", sampleRateHz: 22050, bitRateBps: 4000 }, query: "encoding=aac&bit_rate=4000" },
    { output: { format: "wav", sampleEncoding: "mulaw", sampleRateHz: 16000 }, query: "encoding=mulaw&container=wav&sample_rate=16000" },
  ];
  for (const { output, query } of cases) {
    let requested: string | undefined;
    await Array.fromAsync(synthesize({ ...common, text: "hello", output }, { auth, baseUrl: "https://proxy.example/prefix?tenant=test", fetch: async url => {
      requested = String(url); return new Response(Uint8Array.of(1));
    } }));
    expect(requested).toBe(`https://proxy.example/prefix/v1/speak?tenant=test&model=aura-asteria-en&${query}`);
  }
});
