import { describe, expect, expectTypeOf, test } from "bun:test";
import { synthesize, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";

const base = { voice: "147320", model: "mars8.1-flash-beta", language: "en-us", output: { format: "mp3" } } as const;
const auth = { camb: { apiKey: "test-key" } } as const;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test("generated checks reject unsupported live models before opening a socket", async () => {
  const socket = new Socket();
  // @ts-expect-error Only the 8.1 Flash beta model supports live input.
  const stream = synthesize({ ...base, model: "mars8-flash", text: (async function* () { yield "hello"; })() }, { auth, webSocket: socket });
  await expect(stream.next()).rejects.toEqual(new TypeError("Invalid camb TTS request"));
  expect(socket.sent).toEqual([]);
});

test("generated bounds reject negative text-buffer delay before the live handshake", async () => {
  const socket = new Socket();
  await expect(synthesize({ ...base, text: (async function* () { yield "hello"; })(), textFlushDelayMs: -1 }, { auth, webSocket: socket }).next())
    .rejects.toEqual(new TypeError("Invalid camb TTS request"));
  expect(socket.sent).toEqual([]);
});

test("encoded output cannot carry raw PCM sample settings", async () => {
  const invalid = { ...base, text: "hello", output: { format: "mp3", sampleEncoding: "float_32" } } as unknown as TtsRequest;
  await expect(synthesize(invalid, { auth, fetch: async () => { throw new Error("Unexpected request"); } }).next())
    .rejects.toEqual(new TypeError("Invalid camb TTS request"));
});

test("generated input checks reject controls without transmitting a text chunk", async () => {
  const socket = new Socket();
  const text = (async function* () { yield { command: "clear" }; })() as unknown as AsyncIterable<string>;
  await expect(synthesize({ ...base, text }, { auth, webSocket: socket }).next())
    .rejects.toEqual(new TypeError("Invalid camb TTS input item"));
  expect(socket.sent.map(message => message.type)).toEqual(["session.start"]);
  expect(socket.closes).toBe(1);
});

class Socket implements WebSocketLike {
  readyState = 1;
  binaryType = "blob";
  sent: Record<string, unknown>[] = [];
  closes = 0;
  listeners = new Map<string, Set<(event: any) => void>>();
  onSend: (value: Record<string, unknown>) => void = () => {};
  addEventListener(type: string, listener: (event: any) => void) {
    const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(value: unknown) { this.emit("message", { data: value instanceof Uint8Array ? value : JSON.stringify(value) }); }
  ready() { this.receive({ type: "session.ready", session_id: "session", run_id: 42, config: {} }); }
  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (this.readyState !== 1) throw new Error("late send");
    const value = JSON.parse(String(data)); this.sent.push(value); this.onSend(value);
    if (value.type === "session.start") queueMicrotask(() => this.ready());
  }
  close() { this.closes++; this.readyState = 3; this.emit("close", {}); }
  get listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
}

function stalled() {
  let calls = 0;
  let returns = 0;
  let release!: (value: IteratorResult<string>) => void;
  const text: AsyncIterableIterator<string> = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (calls++ === 0) return Promise.resolve({ value: "hello", done: false });
      return new Promise(resolve => { release = resolve; });
    },
    async return() { returns++; return { value: undefined, done: true }; },
  };
  return { text, returns: () => returns, release: () => release({ value: "late", done: false }) };
}

describe("CAMB HTTP", () => {
  test("uses the byte stream endpoint with the /apis prefix and custom voice ID", async () => {
    let end!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1, 2)); end = () => controller.close(); } });
    const fetch: Fetch = async (url, init) => {
      expect(String(url)).toBe("https://client.camb.ai/apis/tts-stream");
      expect(init?.headers).toEqual({ "x-api-key": "test-key", "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({
        text: "hello", language: "en-us", voice_id: 147320, speech_model: "mars-8.1-flash-beta",
        enhance_named_entities_pronunciation: true,
        output_configuration: { format: "mp3", sample_rate: 24000, apply_enhancement: true },
        voice_settings: { speaking_rate: 1.25, enhance_reference_audio_quality: true, maintain_source_accent: true },
      });
      return new Response(body);
    };
    const stream = synthesize({ ...base, text: "hello", output: { format: "mp3", sampleRateHz: 24000 }, speed: 1.25, audioEnhancement: true, namedEntityPronunciationEnhancement: true, referenceAudioEnhancement: true, accentPreservation: true }, { auth, fetch });
    expect((await stream.next()).value).toEqual(Uint8Array.of(1, 2));
    end();
    expect((await stream.next()).done).toBe(true);
  });

  test.each([
    ["mars8-flash", "mars-flash"], ["mars8-instruct", "mars-instruct"], ["mars8-pro", "mars-pro"],
    ["mars8.1-flash-beta", "mars-8.1-flash-beta"], ["mars8.1-pro-beta", "mars-8.1-pro-beta"],
  ] as const)("maps model %s without changing its generation", async (model, wire) => {
    await Array.fromAsync(synthesize({ ...base, model, text: "hello" }, { auth, fetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body)).speech_model).toBe(wire); return new Response(Uint8Array.of(1));
    } }));
  });

  test.each([
    ["signed_integer_16", "little_endian", "pcm_s16le"], ["signed_integer_16", "big_endian", "pcm_s16be"],
    ["signed_integer_32", "little_endian", "pcm_s32le"], ["signed_integer_32", "big_endian", "pcm_s32be"],
    ["float_32", "little_endian", "pcm_f32le"], ["float_32", "big_endian", "pcm_f32be"],
  ] as const)("maps PCM %s %s", async (sampleEncoding, byteOrder, format) => {
    await Array.fromAsync(synthesize({ ...base, text: "hello", output: { format: "pcm", sampleEncoding, byteOrder } }, { auth, fetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body)).output_configuration.format).toBe(format); return new Response(Uint8Array.of(1));
    } }));
  });

  test("maps AAC framing explicitly and honors an injected API base path", async () => {
    await Array.fromAsync(synthesize({ ...base, text: "hello", output: { format: "aac" } }, { auth, baseUrl: "https://proxy.invalid/custom/", fetch: async (url, init) => {
      expect(String(url)).toBe("https://proxy.invalid/custom/tts-stream");
      expect(JSON.parse(String(init?.body)).output_configuration.format).toBe("adts"); return new Response(Uint8Array.of(1));
    } }));
  });

  test("early consumer exit cancels the HTTP body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; } });
    const stream = synthesize({ ...base, text: "hello" }, { auth, fetch: async () => new Response(body) });
    await stream.next(); await stream.return!(); expect(cancelled).toBe(true);
  });

  test("checks voice IDs, HTTP errors, and pre-aborted signals", async () => {
    await expect(synthesize({ ...base, text: "hello", voice: "1e3" }, { auth }).next()).rejects.toEqual(new TypeError("Invalid camb TTS request"));
    await expect(synthesize({ ...base, text: "hello" }, { auth, fetch: async () => new Response("quota", { status: 429 }) }).next()).rejects.toThrow("HTTP 429: quota");
    const controller = new AbortController(); controller.abort(new Error("stop"));
    let called = false;
    await expect(synthesize({ ...base, text: "hello" }, { auth, signal: controller.signal, fetch: async () => { called = true; return new Response(); } }).next()).rejects.toThrow("stop");
    expect(called).toBe(false);
  });
});

describe("CAMB live synthesis", () => {
  test("streams timestamped frames before segment completion and retains native group identity", async () => {
    const socket = new Socket(); const source = stalled();
    socket.onSend = message => {
      if (message.type === "text.chunk") {
        socket.receive({ type: "segment.start", segment_id: 7, text: "hello", word_timestamps: [{ word: "hello", start: 0.1, end: 0.4 }] });
        socket.receive(Uint8Array.of(1, 2));
      }
    };
    const stream = synthesize({ ...base, text: source.text, timestampGranularity: "word", textFlushDelayMs: 2500, inferenceSteps: 16 }, { auth, webSocket: socket });
    expect((await stream.next()).value).toEqual({ correlation: "ordered", correlationId: "7", timestamps: [{ kind: "word", value: "hello", startTimeMs: 100, endTimeMs: 400 }] });
    expect((await stream.next()).value).toEqual({ correlation: "ordered", correlationId: "7", timestamps: [], audio: Uint8Array.of(1, 2) });
    expect(socket.sent[0]).toMatchObject({ type: "session.start", word_timestamps: true, idle_timeout: 2.5, inference_steps: 16 });
    expect(socket.sent.some(message => message.type === "text.done")).toBe(false);
    await stream.return!(); source.release(); await tick();
    expect(source.returns()).toBe(1); expect(socket.sent).toHaveLength(2); expect(socket.listenerCount).toBe(0);
  });

  test("allows whole text with timestamps through one synthesize operation", async () => {
    const socket = new Socket();
    socket.onSend = message => {
      if (message.type !== "text.done") return;
      for (const id of [0, 1]) {
        socket.receive({ type: "segment.start", segment_id: id, text: "word", word_timestamps: [{ word: "word", start: 0, end: 0.5 }] });
        socket.receive(Uint8Array.of(id));
        socket.receive({ type: "segment.done", segment_id: id });
      }
      socket.receive({ type: "session.done" });
    };
    const values = await Array.fromAsync(dispatch("camb", { ...base, text: "hello world", timestampGranularity: "word" }, { auth, webSocket: socket }));
    expect(values).toEqual([
      { correlation: "ordered", correlationId: "0", timestamps: [{ kind: "word", value: "word", startTimeMs: 0, endTimeMs: 500 }] },
      { correlation: "ordered", correlationId: "0", timestamps: [], audio: Uint8Array.of(0) },
      { correlation: "ordered", correlationId: "1", timestamps: [{ kind: "word", value: "word", startTimeMs: 0, endTimeMs: 500 }] },
      { correlation: "ordered", correlationId: "1", timestamps: [], audio: Uint8Array.of(1) },
    ]);
    expect(socket.closes).toBe(1);
  });

  test("missing best-effort timestamps do not block audio", async () => {
    const socket = new Socket();
    socket.onSend = message => {
      if (message.type !== "text.done") return;
      socket.receive({ type: "segment.start", segment_id: 0, text: "hello", word_timestamps: null });
      socket.receive(Uint8Array.of(1)); socket.receive({ type: "segment.done", segment_id: 0 }); socket.receive({ type: "session.done" });
    };
    const values = await Array.fromAsync(synthesize({ ...base, text: "hello", timestampGranularity: "word" }, { auth, webSocket: socket }));
    expect(values).toEqual([{ correlation: "ordered", correlationId: "0", timestamps: [] }, { correlation: "ordered", correlationId: "0", timestamps: [], audio: Uint8Array.of(1) }]);
  });

  test("waits for session.ready before acquiring the input iterator", async () => {
    const socket = new Socket();
    let acquired = false;
    const text: AsyncIterable<string> = { [Symbol.asyncIterator]() { acquired = true; return { async next() { return { value: undefined, done: true }; } }; } };
    socket.onSend = message => {
      if (message.type === "session.start") expect(acquired).toBe(false);
      if (message.type === "text.done") socket.receive({ type: "session.done" });
    };
    expect(await Array.fromAsync(synthesize({ ...base, text }, { auth, webSocket: socket }))).toEqual([]);
    expect(acquired).toBe(true);
  });

  test("abort rejects stalled synthesis and prevents late text", async () => {
    const source = stalled(); const socket = new Socket(); const controller = new AbortController();
    socket.onSend = message => {
      if (message.type === "text.chunk") { socket.receive({ type: "segment.start", segment_id: 0, text: "hello" }); socket.receive(Uint8Array.of(1)); }
    };
    const stream = synthesize({ ...base, text: source.text }, { auth, webSocket: socket, signal: controller.signal });
    expect((await stream.next()).value).toEqual(Uint8Array.of(1));
    const pending = stream.next(); controller.abort(new Error("cancel"));
    await expect(pending).rejects.toThrow("cancel"); source.release(); await tick();
    expect(source.returns()).toBe(1); expect(socket.sent).toHaveLength(2); expect(socket.listenerCount).toBe(0);
  });

  test.each([
    { type: "segment.skipped", segment_id: 0, text: "lost speech" },
    { type: "session.error", error: "quota exhausted" },
    { type: "segment.done", segment_id: 8 },
    { type: "session.done" },
    { type: "segment.start", segment_id: "invalid", text: "hello" },
  ])("fails explicitly on %j and cleans up input", async value => {
    const source = stalled(); const socket = new Socket();
    socket.onSend = message => { if (message.type === "text.chunk") socket.receive(value); };
    await expect(synthesize({ ...base, text: source.text }, { auth, webSocket: socket }).next()).rejects.toThrow();
    source.release(); expect(source.returns()).toBe(1); expect(socket.listenerCount).toBe(0);
  });

  test("input failure stops a silent server without waiting for completion", async () => {
    const socket = new Socket();
    async function* text() { yield "hello"; throw new Error("input failed"); }
    await expect(synthesize({ ...base, text: text() }, { auth, webSocket: socket }).next()).rejects.toThrow("input failed");
    expect(socket.closes).toBe(1);
  });

  test("abort during iterator acquisition prevents the queued first read", async () => {
    const controller = new AbortController(); const socket = new Socket();
    let reads = 0; let returned = false;
    const text: AsyncIterable<string> = { [Symbol.asyncIterator]() {
      controller.abort(new Error("stop before read"));
      return {
        async next() { reads++; return { value: "late", done: false }; },
        async return() { returned = true; return { value: undefined, done: true }; },
      };
    } };
    await expect(synthesize({ ...base, text }, { auth, webSocket: socket, signal: controller.signal }).next()).rejects.toThrow("stop before read");
    expect(reads).toBe(0); expect(returned).toBe(true); expect(socket.listenerCount).toBe(0);
  });
});

test("CAMB narrows models, output, locales, and unsupported controls", () => {
  async function* text() { yield "hello"; }
  async function* commands() { yield { command: "clear" } as const; }
  const valid: TtsRequest = { ...base, text: text() };
  expectTypeOf(valid.model).toEqualTypeOf<"mars8.1-flash-beta">();
  // @ts-expect-error Live TTS cannot select an older model.
  const legacy: TtsRequest = { ...base, text: text(), model: "mars8-flash" };
  // @ts-expect-error Live TTS does not support raw PCM.
  const pcm: TtsRequest = { ...base, text: text(), output: { format: "pcm", sampleEncoding: "float_32", byteOrder: "little_endian" } };
  // @ts-expect-error There is no documented clear command.
  const clear: TtsRequest = { ...base, text: commands() };
  // @ts-expect-error Old models do not support the live timestamp endpoint.
  const timing: TtsRequest = { ...base, model: "mars8-pro", text: "hello", timestampGranularity: "word" };
  // @ts-expect-error Complete-text REST has no inference-step setting.
  const steps: TtsRequest = { ...base, text: "hello", inferenceSteps: 10 };
  // @ts-expect-error Unsupported locale must not pass normalized type checking.
  const locale: TtsRequest = { ...base, text: "hello", language: "invented" };
  // @ts-expect-error Dispatcher must preserve the provider's model restriction.
  dispatch("camb", { ...base, text: text(), model: "mars8-pro" }, { auth });
  void [legacy, pcm, clear, timing, steps, locale];
});

test("CAMB bundles for browsers without Node runtime shims", async () => {
  const bundle = await Bun.build({ entrypoints: [new URL("index.ts", import.meta.url).pathname], target: "browser" });
  expect(bundle.success).toBe(true);
  expect(await bundle.outputs[0]!.text()).not.toContain("node:");
});
