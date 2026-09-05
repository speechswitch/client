import { describe, expect, expectTypeOf, test } from "bun:test";
import { CartesiaError, synthesize, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { TtsRequest as AmazonRequest } from "../../../schemas/providers/amazon/index.ts";
import type { WebSocketLike } from "../../websocket.ts";

const base = { model: "sonic-3.5", voice: "my-custom-voice", output: { format: "pcm", sampleEncoding: "signed_integer_16", sampleRateHz: 24000, byteOrder: "little_endian" } } as const;
const auth = { cartesia: { apiKey: "test-key" } } as const;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
type Input = string | { readonly command: "clear" | "flush" };

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
  receive(context: unknown, value: Record<string, unknown>) { this.emit("message", { data: JSON.stringify({ status_code: 200, done: false, context_id: context, ...value }) }); }
  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (this.readyState !== 1) throw new Error("late send");
    const value = JSON.parse(String(data)); this.sent.push(value); this.onSend(value);
  }
  close() { this.closes++; this.readyState = 3; this.emit("close", {}); }
  get listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
}

function input() {
  let resolve!: (value: IteratorResult<Input>) => void;
  let reads = 0; let returns = 0;
  const text: AsyncIterableIterator<Input> = {
    [Symbol.asyncIterator]() { return this; },
    next() { reads++; return new Promise(value => { resolve = value; }); },
    async return() { returns++; return { value: undefined, done: true }; },
  };
  return { text, reads: () => reads, returns: () => returns, send(value: Input) { resolve({ value, done: false }); }, end() { resolve({ value: undefined, done: true }); } };
}

async function* chunks(...values: Input[]) { yield* values; }
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

describe("Cartesia HTTP", () => {
  test("streams bytes immediately and maps custom voice, independent controls, and auth", async () => {
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1, 2)); finish = () => controller.close(); } });
    const stream = synthesize({ ...base, text: "hello", language: "en", accent: "fr", lexicon: "dictionary", speed: 1.2, volumeScale: 0.8, emotion: "excited", textNormalization: { locale: "en-IN" } }, { auth, fetch: async (url, init) => {
      expect(String(url)).toBe("https://api.cartesia.ai/tts/bytes");
      expect(init?.headers).toEqual({ authorization: "Bearer test-key", "cartesia-version": "2026-08-14", "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({
        model_id: "sonic-3.5", voice: "my-custom-voice", transcript: "hello", language: "en", accent: "fr", normalization: "en-IN", pronunciation_dict_id: "dictionary",
        output_format: { container: "raw", sample_rate: 24000, encoding: "pcm_s16le" }, generation_config: { speed: 1.2, volume: 0.8, emotion: "excited" },
      });
      return new Response(body);
    } });
    expect((await stream.next()).value).toEqual(Uint8Array.of(1, 2));
    finish(); expect((await stream.next()).done).toBe(true);
  });

  test("Sonic 3.6 uses locale alone and supports access-token HTTP auth", async () => {
    await Array.fromAsync(synthesize({ ...base, model: "sonic-3.6", text: "hello", language: "en-GB", textNormalization: false, output: { format: "mp3", sampleRateHz: 44100, bitRateBps: 128000 } }, {
      auth: { cartesia: { accessToken: "token" } }, fetch: async (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ locale: "en-GB", normalization: "off", output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 } });
        expect(body).not.toHaveProperty("language"); return new Response(Uint8Array.of(1));
      },
    }));
  });

  test.each([
    [{ format: "pcm", sampleRateHz: 48000, sampleEncoding: "float_32", byteOrder: "little_endian" }, "raw", "pcm_f32le"],
    [{ format: "mulaw", sampleRateHz: 8000 }, "raw", "pcm_mulaw"],
    [{ format: "alaw", sampleRateHz: 8000 }, "raw", "pcm_alaw"],
    [{ format: "wav", sampleRateHz: 22050 }, "wav", "pcm_s16le"],
    [{ format: "wav", sampleRateHz: 16000, sampleEncoding: "alaw" }, "wav", "pcm_alaw"],
  ] as const)("maps output %j", async (output, container, encoding) => {
    await Array.fromAsync(synthesize({ ...base, text: "hello", output }, { auth, fetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body)).output_format).toEqual({ container, sample_rate: output.sampleRateHz, encoding });
      return new Response(Uint8Array.of(1));
    } }));
  });

  test("preserves structured HTTP errors, null codes, and future codes", async () => {
    for (const errorCode of [null, "future_error"]) {
      const stream = synthesize({ ...base, text: "hello" }, { auth, fetch: async () => new Response(JSON.stringify({ error_code: errorCode, title: "Quota", message: "exhausted", request_id: "req", doc_url: "https://docs.cartesia.ai" }), { status: 429 }) });
      try { await stream.next(); throw new Error("Expected failure"); } catch (error) {
        expect(error).toBeInstanceOf(CartesiaError);
        expect(error).toMatchObject({ statusCode: 429, errorCode, requestId: "req", docUrl: "https://docs.cartesia.ai" });
        expect(String(error)).toContain("exhausted");
      }
    }
    await expect(synthesize({ ...base, text: "hello" }, { auth, fetch: async () => new Response("upstream unavailable", { status: 502 }) }).next()).rejects.toThrow("upstream unavailable");
  });

  test("early exit cancels the response body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; } });
    const stream = synthesize({ ...base, text: "hello" }, { auth, fetch: async () => new Response(body) });
    await stream.next(); await stream.return!(); expect(cancelled).toBe(true);
  });
});

describe("Cartesia SSE", () => {
  test("can request word and phoneme timings together", async () => {
    const result = await Array.fromAsync(synthesize({ ...base, text: "hi", timestampGranularity: ["word", "phoneme"] }, { auth, fetch: async (_url, init) => {
      const wire = JSON.parse(String(init?.body)); expect(wire.add_timestamps).toBe(true); expect(wire.add_phoneme_timestamps).toBe(true);
      return new Response(
        event({ type: "timestamps", done: false, status_code: 200, word_timestamps: { words: ["hi"], start: [0], end: [0.2] } }) +
        event({ type: "phoneme_timestamps", done: false, status_code: 200, phoneme_timestamps: { phonemes: ["h"], start: [0], end: [0.1] } }) +
        event({ type: "done", done: true, status_code: 200 }),
      );
    } }));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ timestamps: [{ kind: "word", value: "hi" }] });
    expect(result[1]).toMatchObject({ timestamps: [{ kind: "phoneme", value: "h" }] });
  });

  test.each(["word", "phoneme"] as const)("streams %s timestamps independently from audio on their shared timeline", async kind => {
    let finish!: () => void; let contextId = ""; let cancelled = false;
    const stream = dispatch("cartesia", { ...base, text: "hé", timestampGranularity: kind, timestampText: "normalized" }, { auth, fetch: async (url, init) => {
      expect(String(url)).toBe("https://api.cartesia.ai/tts/sse");
      const wire = JSON.parse(String(init?.body)); contextId = wire.context_id;
      expect(wire).toMatchObject({ add_timestamps: kind === "word", add_phoneme_timestamps: kind === "phoneme", use_normalized_timestamps: true });
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        const first = event({ type: "chunk", data: "AQI=", done: false, status_code: 200, context_id: null });
        for (const byte of new TextEncoder().encode(first)) controller.enqueue(Uint8Array.of(byte));
        finish = () => {
          controller.enqueue(new TextEncoder().encode(event({ type: kind === "word" ? "timestamps" : "phoneme_timestamps", done: false, status_code: 200, context_id: contextId, [kind === "word" ? "word_timestamps" : "phoneme_timestamps"]: { [kind === "word" ? "words" : "phonemes"]: ["hé"], start: [0.1], end: [0.2] } }) + event({ type: "done", done: true, status_code: 200 })));
        };
      }, cancel() { cancelled = true; } });
      return new Response(body);
    } });
    expect((await stream.next()).value).toEqual({ correlation: "timeline", correlationId: contextId, audio: Uint8Array.of(1, 2), timestamps: [] });
    finish();
    expect((await stream.next()).value).toEqual({ correlation: "timeline", correlationId: contextId, timestamps: [{ kind, value: "hé", startTimeMs: 100, endTimeMs: 200 }] });
    expect((await stream.next()).done).toBe(true); expect(cancelled).toBe(true);
  });

  test.each([
    [event({ type: "timestamps", done: false, status_code: 200, word_timestamps: { words: ["hello"], start: [], end: [1] } }), "mismatched"],
    [event({ type: "timestamps", done: false, status_code: 200, word_timestamps: { words: ["hello"], start: [2], end: [1] } }), "invalid timestamp"],
    [event({ type: "unknown", done: false, status_code: 200 }), "Unknown Cartesia"],
    [event({ type: "done", done: true, status_code: 200, context_id: "wrong" }), "unexpected context"],
    ["", "ended before"],
    [event({ type: "error", done: true, status_code: 500, error_code: null, title: "Failure", message: "speech failed", request_id: "req", doc_url: null }), "speech failed"],
  ])("rejects invalid or failed SSE: %s", async (body, message) => {
    await expect(synthesize({ ...base, text: "hello", timestampGranularity: "word" }, { auth, fetch: async () => new Response(body) }).next()).rejects.toThrow(message);
  });
});

describe("Cartesia WebSocket", () => {
  test("flush preserves its context, native input groups, and subsequent audio", async () => {
    const socket = new Socket(); let contextId = "";
    socket.onSend = wire => {
      if (typeof wire.context_id !== "string") throw new Error("Missing context ID");
      contextId ||= wire.context_id; expect(wire.context_id).toBe(contextId);
      expect(wire).toMatchObject({ model_id: "sonic-3.5", voice: "my-custom-voice", max_buffer_delay_ms: 0, add_timestamps: true, generation_config: { emotion: "excited" } });
      if (wire.transcript === "hello ") socket.receive(contextId, { type: "chunk", data: "AQ==", flush_id: 1 });
      if (wire.flush) { expect(wire.continue).toBe(true); expect(wire.transcript).toBe(""); socket.receive(contextId, { type: "flush_done", done: true, flush_done: true, flush_id: 1 }); }
      if (wire.transcript === "world") socket.receive(contextId, { type: "chunk", data: "Ag==", flush_id: 2 });
      if (wire.continue === false) {
        socket.receive(contextId, { type: "timestamps", word_timestamps: { words: ["world"], start: [0.5], end: [1] }, flush_id: 2 });
        socket.receive(contextId, { type: "done", done: true });
      }
    };
    const result = await Array.fromAsync(synthesize({ ...base, text: chunks("hello ", { command: "flush" }, "world"), maxBufferDelayMs: 0, timestampGranularity: "word", emotion: "excited" }, { webSocket: socket }));
    expect(result).toEqual([
      { correlation: "timeline", correlationId: contextId, inputGroupId: "1", audio: Uint8Array.of(1), timestamps: [] },
      { event: "flush", correlationId: contextId, inputGroupId: "1" },
      { correlation: "timeline", correlationId: contextId, inputGroupId: "2", audio: Uint8Array.of(2), timestamps: [] },
      { correlation: "timeline", correlationId: contextId, inputGroupId: "2", timestamps: [{ kind: "word", value: "world", startTimeMs: 500, endTimeMs: 1000 }] },
    ]);
    expect(socket.sent.map(wire => wire.transcript)).toEqual(["hello ", "", "world", ""]);
    expect(socket.closes).toBe(1); expect(socket.listenerCount).toBe(0);
  });

  test("clear rotates context and discards late old audio, timing, errors, and completion", async () => {
    const socket = new Socket(); const source = input(); let oldId: unknown; let newId: unknown;
    socket.onSend = wire => {
      if (wire.transcript === "old") { oldId = wire.context_id; socket.receive(oldId, { type: "chunk", data: "AQ==" }); }
      if (wire.cancel) {
        expect(wire.context_id).toBe(oldId);
        socket.receive(oldId, { type: "chunk", data: "Ag==" });
        socket.receive(oldId, { type: "timestamps", word_timestamps: { words: ["old"], start: [0], end: [1] } });
        socket.receive(oldId, { type: "error", status_code: 500, message: "cancelled generation failed", error_code: null });
        socket.receive(oldId, { type: "done", done: true });
      }
      if (wire.transcript === "new") { newId = wire.context_id; socket.receive(newId, { type: "chunk", data: "Aw==" }); }
      if (wire.continue === false) socket.receive(wire.context_id, { type: "done", done: true });
    };
    const stream = synthesize({ ...base, text: source.text }, { webSocket: socket });
    let next = stream.next(); await tick(); source.send("old");
    expect((await next).value).toEqual(Uint8Array.of(1));
    next = stream.next(); await tick(); source.send({ command: "clear" });
    expect((await next).value).toEqual({ event: "clear" });
    next = stream.next(); await tick(); source.send("new");
    expect((await next).value).toEqual(Uint8Array.of(3)); expect(newId).not.toBe(oldId);
    next = stream.next(); await tick(); source.end(); expect((await next).done).toBe(true);
    expect(socket.sent.filter(wire => wire.cancel)).toHaveLength(1); expect(socket.listenerCount).toBe(0);
  });

  test("clear and flush before text do not create or cancel unused contexts", async () => {
    const socket = new Socket();
    expect(await Array.fromAsync(synthesize({ ...base, text: chunks({ command: "clear" }, { command: "flush" }, "", { command: "clear" }) }, { webSocket: socket }))).toEqual([{ event: "clear" }, { event: "clear" }]);
    expect(socket.sent).toEqual([]); expect(socket.listenerCount).toBe(0);
  });

  test("completed contexts rotate while the input remains open", async () => {
    const socket = new Socket(); const source = input(); const ids: unknown[] = [];
    socket.onSend = wire => {
      if (wire.transcript) {
        ids.push(wire.context_id); socket.receive(wire.context_id, { type: "chunk", data: "AQ==" });
        socket.receive(wire.context_id, { type: "done", done: true });
      }
    };
    const stream = synthesize({ ...base, text: source.text }, { webSocket: socket });
    let next = stream.next(); await tick(); source.send("first"); await next;
    next = stream.next(); await tick(); source.send("second"); await next;
    expect(ids).toHaveLength(2); expect(ids[0]).not.toBe(ids[1]);
    next = stream.next(); await tick(); source.end(); expect((await next).done).toBe(true);
  });

  test.each(["abort", "return"])("%s cleans up stalled input without a late send", async mode => {
    const socket = new Socket(); const source = input(); const controller = new AbortController();
    socket.onSend = wire => { if (wire.transcript) socket.receive(wire.context_id, { type: "chunk", data: "AQ==" }); };
    const stream = synthesize({ ...base, text: source.text }, { webSocket: socket, signal: controller.signal });
    const next = stream.next(); await tick(); source.send("hello"); await next;
    if (mode === "abort") { const pending = stream.next(); await tick(); controller.abort(new Error("stop")); await expect(pending).rejects.toThrow("stop"); }
    else await stream.return!();
    source.send("late"); await tick();
    expect(socket.sent).toHaveLength(1); expect(source.returns()).toBe(1); expect(socket.listenerCount).toBe(0);
  });

  test.each(["input", "close", "server", "invalid"])("fails and cleans up on %s error", async failure => {
    const socket = new Socket(); let returned = false;
    async function* text() { try { yield "hello"; if (failure === "input") throw new Error("input failed"); await new Promise(() => {}); } finally { returned = true; } }
    socket.onSend = wire => {
      if (failure === "close") socket.close();
      if (failure === "server") socket.receive(undefined, { type: "error", status_code: 429, message: "quota exhausted", error_code: "future", request_id: "request" });
      if (failure === "invalid") socket.receive(wire.context_id, { type: "chunk", data: 42 });
    };
    await expect(synthesize({ ...base, text: text() }, { webSocket: socket }).next()).rejects.toThrow();
    expect(socket.listenerCount).toBe(0); if (failure === "input") expect(returned).toBe(true);
  });

  test("iterator acquisition failure and abort during acquisition close the socket", async () => {
    const socket = new Socket();
    const throwing: AsyncIterable<string> = { [Symbol.asyncIterator]() { throw new Error("acquisition failed"); } };
    await expect(synthesize({ ...base, text: throwing }, { webSocket: socket }).next()).rejects.toThrow("acquisition failed");
    expect(socket.listenerCount).toBe(0);
    const aborted = new Socket(); const controller = new AbortController(); let reads = 0; let returned = false;
    const text: AsyncIterable<string> = { [Symbol.asyncIterator]() {
      controller.abort(new Error("acquisition aborted"));
      return { async next() { reads++; return { value: "late", done: false }; }, async return() { returned = true; return { value: undefined, done: true }; } };
    } };
    await expect(synthesize({ ...base, text }, { webSocket: aborted, signal: controller.signal }).next()).rejects.toThrow("acquisition aborted");
    expect(reads).toBe(0); expect(returned).toBe(true); expect(aborted.listenerCount).toBe(0);
  });

  test("deadlines cover silent network and input waits", async () => {
    const source = input(); const socket = new Socket();
    await expect(synthesize({ ...base, text: source.text }, { webSocket: socket, timeoutMs: 10 }).next()).rejects.toThrow("deadline expired");
    expect(source.returns()).toBe(1); expect(socket.listenerCount).toBe(0);
    let fetched = false;
    await expect(synthesize({ ...base, text: "hello" }, { auth, timeoutMs: 0, fetch: async () => { fetched = true; return new Response(); } }).next()).rejects.toThrow("deadline expired");
    expect(fetched).toBe(false);
  });

  test("abort during token exchange prevents the native handshake", async () => {
    const controller = new AbortController();
    await expect(synthesize({ ...base, text: chunks("hello") }, { auth, signal: controller.signal, webSocketUrl: "invalid", fetch: async () => {
      controller.abort(new Error("cancel token exchange")); return Response.json({ token: "token" });
    } }).next()).rejects.toThrow("cancel token exchange");
  });

  test("validates the TTS-only token exchange before opening a native socket", async () => {
    await expect(synthesize({ ...base, text: chunks("hello") }, { auth, fetch: async (url, init) => {
      expect(String(url)).toBe("https://api.cartesia.ai/access-token");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      expect(JSON.parse(String(init?.body))).toEqual({ grants: { tts: true }, expires_in: 60 });
      return Response.json({ token: "" });
    } }).next()).rejects.toThrow("invalid access token");
    await expect(synthesize({ ...base, text: chunks("hello") }, { auth, fetch: async () => new Response("token denied", { status: 401 }) }).next()).rejects.toThrow("token denied");
  });

  test("an injected authenticated socket needs no token exchange", async () => {
    const socket = new Socket();
    await Array.fromAsync(synthesize({ ...base, text: chunks() }, { auth, webSocket: socket, fetch: async () => { throw new Error("unexpected token exchange"); } }));
    expect(socket.closes).toBe(1);
  });
});

test("Cartesia request constraints and Amazon's narrower iterable remain checked", () => {
  async function* text() { yield "hello"; }
  const valid: TtsRequest = { ...base, text: text(), timestampGranularity: "phoneme" };
  expectTypeOf(valid.timestampGranularity).toEqualTypeOf<"word" | "phoneme" | readonly ("word" | "phoneme")[]>();
  // @ts-expect-error Streaming input cannot select MP3.
  const mp3: TtsRequest = { ...base, text: text(), output: { format: "mp3", sampleRateHz: 24000, bitRateBps: 128000 } };
  // @ts-expect-error Timestamped HTTP uses raw SSE, not WAV.
  const wav: TtsRequest = { ...base, text: "hello", timestampGranularity: "word", output: { format: "wav", sampleRateHz: 24000 } };
  // @ts-expect-error Unrecognized emotions are explicitly unsupported.
  const emotion: TtsRequest = { ...base, text: text(), emotion: "invented" };
  // @ts-expect-error Regional locale requires Sonic 3.6.
  const language: TtsRequest = { ...base, text: "hello", language: "en-GB" };
  // @ts-expect-error Only one pronunciation dictionary is supported.
  const lexicon: TtsRequest = { ...base, text: "hello", lexicon: ["a", "b"] };
  // @ts-expect-error Byte order is an orthogonal constraint, not inferred from sample rate.
  const pcm: TtsRequest = { ...base, text: "hello", output: { format: "pcm", sampleRateHz: 24000, sampleEncoding: "signed_integer_16", byteOrder: "big_endian" } };
  // @ts-expect-error Timestamp text cannot be selected without timestamps.
  const timing: TtsRequest = { ...base, text: "hello", timestampText: "original" };
  // @ts-expect-error Dispatcher preserves the provider's restrictions.
  dispatch("cartesia", { ...base, text: text(), emotion: "invented" });
  expectTypeOf<AmazonRequest["text"]>().toEqualTypeOf<string | AsyncIterable<string>>();
  void [mp3, wav, emotion, language, lexicon, pcm, timing];
});

test("Cartesia bundles for browsers without Node runtime shims", async () => {
  const bundle = await Bun.build({ entrypoints: [new URL("index.ts", import.meta.url).pathname], target: "browser" });
  expect(bundle.success).toBe(true); expect(await bundle.outputs[0]!.text()).not.toContain("node:");
});
