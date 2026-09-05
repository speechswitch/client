import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { synthesize as dispatchSynthesize } from "../../dispatch.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, voice, voices, type StreamEvent } from "./index.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import { validateRequest as validateAmazonRequest } from "../../generated/validators/amazon.ts";
import { validateRequest } from "../../generated/validators/xai.ts";

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "";
  sent: string[] = [];
  closed = false;
  autoReply = true;
  onSend?: (message: Record<string, unknown>) => void;
  private listeners = new Map<string, Array<(event: any) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    this.sent.push(String(data));
    const message = JSON.parse(String(data)) as Record<string, unknown>;
    this.onSend?.(message);
    if (!this.autoReply) return;
    if (message.type === "session.update") {
      queueMicrotask(() => this.receive({ type: "session.updated", replace: message.replace }));
    }
    if (message.type === "text.clear") {
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({ type: "audio.clear" }),
      }));
    }
    if (message.type === "text.done") {
      queueMicrotask(() => {
        this.emit("message", { data: JSON.stringify({ type: "audio.delta", delta: "AQI=" }) });
        this.emit("message", { data: JSON.stringify({ type: "audio.done" }) });
      });
    }
  }
  close() { this.closed = true; }
  receive(message: unknown) { this.emit("message", { data: JSON.stringify(message) }); }
  disconnect() { this.emit("close", {}); }
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

const auth = { xai: { apiKey: "test-key" } } as const;

describe("xAI TTS", () => {
  test("omitted and undefined language resolve to auto while explicit language is preserved", async () => {
    for (const request of [{ text: "hello" }, { text: "hello", language: undefined }, { text: "hello", language: "fr" as const }]) {
      let language: unknown;
      await Array.fromAsync(synthesize(request, { auth, fetch: async (_url, init) => {
        language = JSON.parse(String(init?.body)).language;
        return new Response(Uint8Array.of(1));
      } }));
      expect(language).toBe(request.language ?? "auto");
    }
  });

  test("narrows stream control and events by provider", () => {
    type AmazonText = Parameters<typeof amazonSynthesize>[0]["text"];
    type XaiText = Parameters<typeof synthesize>[0]["text"];
    expectTypeOf<AmazonText>().toEqualTypeOf<string | AsyncIterable<string>>();
    expectTypeOf<XaiText>().toEqualTypeOf<
      string | AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" } | {
        readonly command: "update";
        readonly replacements: readonly { readonly pattern: string; readonly replacement: string }[];
      }>
    >();
    expectTypeOf<ReturnType<typeof amazonSynthesize>>().toEqualTypeOf<
      AsyncIterableIterator<Uint8Array>
    >();
    expectTypeOf<ReturnType<typeof synthesize>>().toEqualTypeOf<
      AsyncIterableIterator<Uint8Array | SynthesisEnvelope<Timestamp<"character">> | StreamEvent>
    >();

    const amazon = dispatchSynthesize("amazon", {
      text: "hello",
      voice: "Joanna",
      output: { format: "mp3" },
    });
    const xai = dispatchSynthesize("xai", { text: "hello", language: "en" });
    expectTypeOf(amazon).toEqualTypeOf<AsyncIterableIterator<Uint8Array>>();
    expectTypeOf(xai).toEqualTypeOf<
      AsyncIterableIterator<Uint8Array | SynthesisEnvelope<Timestamp<"character">> | StreamEvent>
    >();
  });

  test("uses byte-native REST synthesis for string input", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(1, 2, 3));
    };
    expect(await Array.fromAsync(synthesize({
      text: "hello",
      voice: "eve",
      model: "grok-tts",
      language: "en",
      output: { format: "mp3", sampleRateHz: 24000, bitRateBps: 128000 },
      speed: 1.1,
      textNormalization: true,
      latencyOptimization: "aggressive",
      replacements: [{ pattern: "xAI", replacement: "X A I" }],
    }, { auth, fetch }))).toEqual([Uint8Array.of(1, 2, 3)]);
    expect(url).toBe("https://api.x.ai/v1/tts");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "hello",
      voice_id: "eve",
      language: "en",
      output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 },
      text_normalization: true,
      optimize_streaming_latency: 2,
      speed: 1.1,
      replace: { xAI: "X A I" },
    });
  });

  test("uses WebSocket synthesis only for streaming input", async () => {
    const socket = new FakeWebSocket();
    const audio = await Array.fromAsync(synthesize({
      text: (async function* () { yield "hel"; yield "lo"; })(),
      language: "en",
    }, { auth, webSocket: socket }));
    expect(audio).toEqual([Uint8Array.of(1, 2), { event: "done" }]);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { type: "text.delta", delta: "hel" },
      { type: "text.delta", delta: "lo" },
      { type: "text.done" },
    ]);
  });

  test("passes clear commands through and yields clear events", async () => {
    const socket = new FakeWebSocket();
    const output = await Array.fromAsync(synthesize({
      text: (async function* () {
        yield "first";
        yield { command: "clear" } as const;
        yield "replacement";
      })(),
      language: "en",
    }, { auth, webSocket: socket }));

    expect(output).toEqual([{ event: "clear" }, Uint8Array.of(1, 2), { event: "done" }]);
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { type: "text.delta", delta: "first" },
      { type: "text.clear" },
      { type: "text.delta", delta: "replacement" },
      { type: "text.done" },
    ]);
  });

  test("preserves native character-to-audio chunk correlation", async () => {
    const fetch: Fetch = async () => Response.json({
      audio: "AwQ=",
      content_type: "audio/mpeg",
      duration: 0.2,
      audio_timestamps: {
        graph_chars: ["H", "i"],
        graph_times: [[0, 0.1], [0.1, 0.2]],
      },
    });
    expect(await Array.fromAsync(synthesize({ text: "Hi", language: "en", timestampGranularity: "character" }, {
      auth,
      fetch,
    }))).toEqual([{
      correlation: "chunk",
      audio: Uint8Array.of(3, 4),
      durationMs: 200,
      timestamps: [
        { kind: "character", value: "H", startTimeMs: 0, endTimeMs: 100 },
        { kind: "character", value: "i", startTimeMs: 100, endTimeMs: 200 },
      ],
    }]);
  });

  test("exposes voice operations", async () => {
    const fetch: Fetch = async (input) => String(input).endsWith("/voices")
      ? Response.json({ voices: [{ voice_id: "eve", name: "Eve", language: "en" }] })
      : Response.json({ voice_id: "eve", name: "Eve", language: "en" });
    expect(await voices({ auth, fetch })).toHaveLength(1);
    expect(await voice("eve", { auth, fetch })).toMatchObject({ voice_id: "eve" });
  });

  test("updates and removes the replacement map, exposing the actual server echo", async () => {
    const socket = new FakeWebSocket();
    socket.autoReply = false;
    socket.onSend = message => {
      if (message.type === "session.update") socket.receive({ type: "session.updated", replace: { echoed: "from server" } });
    };
    const result = await Array.fromAsync(synthesize({ language: "en",
      replacements: [{ pattern: "first", replacement: "initial" }],
      text: (async function* () {
        yield { command: "update", replacements: [{ pattern: "Acme Mobile", replacement: "Acme Mobull" }] } as const;
        yield { command: "update", replacements: [] } as const;
      })(),
    }, { auth, webSocket: socket }));
    expect(socket.sent.map(value => JSON.parse(value))).toEqual([
      { type: "session.update", replace: { first: "initial" } },
      { type: "session.update", replace: { "Acme Mobile": "Acme Mobull" } },
      { type: "session.update", replace: {} },
    ]);
    expect(result).toEqual(Array.from({ length: 3 }, () => ({ event: "updated", replacements: [{ pattern: "echoed", replacement: "from server" }] })));
    expect(socket.closed).toBe(true);
  });

  test("flush ends an utterance, not the input iterator or connection", async () => {
    const socket = new FakeWebSocket();
    socket.autoReply = false;
    let awaitingDone = false;
    let turn = 0;
    socket.onSend = message => {
      if (message.type === "text.delta") expect(awaitingDone).toBe(false);
      if (message.type === "session.update") socket.receive({ type: "session.updated", replace: message.replace });
      if (message.type === "text.done") {
        awaitingDone = true;
        setTimeout(() => {
          awaitingDone = false;
          socket.receive({ type: "audio.delta", delta: "AQI=" });
          socket.receive({ type: "audio.done", trace_id: `turn-${++turn}` });
        }, 5);
      }
    };
    const replacements = [{ pattern: "Acme", replacement: "Ack me" }];
    const result = await Array.fromAsync(synthesize({ language: "en", text: (async function* () {
      yield "first";
      yield { command: "flush" } as const;
      yield { command: "update", replacements } as const;
      yield "second";
      yield { command: "flush" } as const;
    })() }, { auth, webSocket: socket }));
    expect(result.filter(value => !(value instanceof Uint8Array))).toEqual([
      { event: "updated", replacements }, { event: "done", traceId: "turn-1" }, { event: "done", traceId: "turn-2" },
    ]);
    expect(socket.sent.map(value => JSON.parse(value))).toEqual([
      { type: "text.delta", delta: "first" }, { type: "text.done" },
      { type: "session.update", replace: { Acme: "Ack me" } },
      { type: "text.delta", delta: "second" }, { type: "text.done" },
    ]);
  });

  test("clear cancels a flushing utterance and waits for ACK before new text", async () => {
    const socket = new FakeWebSocket();
    socket.autoReply = false;
    let cleared = false;
    let dones = 0;
    socket.onSend = message => {
      if (message.type === "text.clear") {
        socket.receive({ type: "audio.delta", delta: "AwQ=" });
        socket.receive({ type: "audio.done", trace_id: "cancelled" });
        setTimeout(() => { cleared = true; socket.receive({ type: "audio.clear" }); }, 5);
      }
      if (message.type === "text.delta" && message.delta === "second") expect(cleared).toBe(true);
      if (message.type === "text.done" && ++dones === 2) {
        socket.receive({ type: "audio.delta", delta: "AQI=" });
        socket.receive({ type: "audio.done" });
      }
    };
    const result = await Array.fromAsync(synthesize({ language: "en", text: (async function* () {
      yield "first";
      yield { command: "flush" } as const;
      yield { command: "clear" } as const;
      yield "second";
    })() }, { auth, webSocket: socket }));
    expect(result).toEqual([{ event: "clear" }, Uint8Array.of(1, 2), { event: "done" }]);
  });

  test("empty and clear-only iterators finish without waiting for nonexistent audio", async () => {
    for (const clear of [false, true]) {
      const socket = new FakeWebSocket();
      const result = await Array.fromAsync(synthesize({ language: "en", text: (async function* () {
        yield "";
        yield { command: "flush" } as const;
        if (clear) yield { command: "clear" } as const;
      })() }, { auth, webSocket: socket }));
      expect(result).toEqual(clear ? [{ event: "clear" }] : []);
      expect(socket.closed).toBe(true);
    }
  });

  test("propagates iterator failure while output is idle", async () => {
    const socket = new FakeWebSocket();
    const failure = new Error("input failed");
    const result = Array.fromAsync(synthesize({ language: "en", text: (async function* () {
      yield "first";
      throw failure;
    })() }, { auth, webSocket: socket }));
    await expect(result).rejects.toBe(failure);
    expect(socket.closed).toBe(true);
  });

  test("abort releases a stalled producer without awaiting its return", async () => {
    const socket = new FakeWebSocket();
    const controller = new AbortController();
    let returned = false;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const text: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: () => { started(); return new Promise(() => {}); },
        return: () => { returned = true; return new Promise(() => {}); },
      }),
    };
    const result = Array.fromAsync(synthesize({ language: "en", text }, { auth, webSocket: socket, signal: controller.signal }));
    await ready;
    const failure = new Error("cancelled");
    controller.abort(failure);
    await expect(result).rejects.toBe(failure);
    expect(returned).toBe(true);
    expect(socket.closed).toBe(true);
  });

  test("early consumer return cleans up input and socket", async () => {
    const socket = new FakeWebSocket();
    socket.onSend = message => { if (message.type === "text.delta") socket.receive({ type: "audio.delta", delta: "AQI=" }); };
    let returned = false;
    const text: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: "text" }),
        return: async () => { returned = true; return { done: true, value: undefined }; },
      }),
    };
    for await (const _ of synthesize({ language: "en", text }, { auth, webSocket: socket })) break;
    expect(returned).toBe(true);
    expect(socket.closed).toBe(true);
  });

  test("schema-derived checks retain provider-specific command narrowing", () => {
    const text = (async function* () { yield "hello"; })();
    const xai = validateRequest({ text, language: "en" });
    const amazon = validateAmazonRequest({ text, voice: "Joanna", model: "generative", output: { format: "mp3" } });
    for (const command of [{ command: "update", replacements: [] }, { command: "flush" }, { command: "clear" }]) {
      expect(() => xai(command)).not.toThrow();
      expect(() => amazon(command)).toThrow();
    }
    expect(() => xai({ command: "update" })).toThrow();
    expect(() => xai({ command: "update", replacements: [{ pattern: "Acme", replacement: 123 }] })).toThrow();
    expect(() => xai({ command: "unknown" })).toThrow();
    expect(() => validateRequest({ text, language: "en", speed: 2 })).toThrow();
    expect(() => validateRequest({ text, language: "en", output: { format: "pcm", bitRateBps: 128000 } })).toThrow();
    expect(() => validateRequest({ text, language: "en", output: { format: "pcm", sampleRateHz: 48000 } })).not.toThrow();
  });

  test("rejects equivalent replacement phrases instead of silently overwriting", async () => {
    const replacements = [{ pattern: "Acme  Mobile", replacement: "one" }, { pattern: " ACME Mobile ", replacement: "two" }];
    let called = false;
    await expect(Array.fromAsync(synthesize({ text: "hello", language: "en", replacements }, {
      auth, fetch: async () => { called = true; return new Response(); },
    }))).rejects.toThrow("Duplicate xAI replacement phrase");
    expect(called).toBe(false);
    const socket = new FakeWebSocket();
    await expect(Array.fromAsync(synthesize({ language: "en", text: (async function* () {
      yield { command: "update", replacements } as const;
    })() }, { auth, webSocket: socket }))).rejects.toThrow("Duplicate xAI replacement phrase");
    expect(socket.sent).toEqual([]);
    expect(socket.closed).toBe(true);
  });

  test("rejects malformed ACKs and early socket closure", async () => {
    for (const malformed of [true, false]) {
      const socket = new FakeWebSocket();
      socket.autoReply = false;
      socket.onSend = message => {
        if (message.type === "session.update") {
          if (malformed) socket.receive({ type: "session.updated", replace: { invalid: 42 } });
          else socket.disconnect();
        }
      };
      await expect(Array.fromAsync(synthesize({ language: "en", replacements: [], text: (async function* () {})() }, {
        auth, webSocket: socket,
      }))).rejects.toThrow(malformed ? "replacement map" : "closed before");
    }
  });

  test("streaming timestamps retain native chunk duration and substituted characters", async () => {
    const socket = new FakeWebSocket();
    socket.autoReply = false;
    socket.onSend = message => {
      if (message.type === "text.done") {
        socket.receive({ type: "audio.delta", delta: "AQI=", audio_duration: 0.25,
          audio_timestamps: { graph_chars: ["X"], graph_times: [[0.05, 0.2]] } });
        socket.receive({ type: "audio.done", trace_id: "native-trace" });
      }
    };
    expect(await Array.fromAsync(synthesize({ language: "en", timestampGranularity: "character",
      text: (async function* () { yield "original text"; })(),
    }, { auth, webSocket: socket }))).toEqual([
      { correlation: "chunk", audio: Uint8Array.of(1, 2), durationMs: 250,
        timestamps: [{ kind: "character", value: "X", startTimeMs: 50, endTimeMs: 200 }] },
      { event: "done", traceId: "native-trace" },
    ]);
  });

  test("rejects malformed native timestamp intervals", async () => {
    for (const graph_times of [[[1, 0]], [[0, "1"]], [[0]], []]) {
      await expect(Array.fromAsync(synthesize({ text: "hi", language: "en", timestampGranularity: "character" }, {
        auth, fetch: async () => Response.json({ audio: "AQI=", audio_timestamps: { graph_chars: ["h"], graph_times } }),
      }))).rejects.toThrow();
    }
  });

  test("type checker rejects xAI update commands on Amazon and incomplete xAI updates", () => {
    const updates = (async function* () { yield { command: "update", replacements: [] } as const; })();
    // @ts-expect-error Amazon accepts only strings in its input stream.
    dispatchSynthesize("amazon", { text: updates, voice: "Joanna", model: "generative", output: { format: "mp3" } });
    const missing = (async function* () { yield { command: "update" } as const; })();
    // @ts-expect-error An update must provide its replacement map.
    dispatchSynthesize("xai", { text: missing, language: "en" });
  });

  test("pre-abort never calls an injected HTTP transport", async () => {
    const controller = new AbortController();
    const failure = new Error("cancelled before request");
    controller.abort(failure);
    let called = false;
    await expect(Array.fromAsync(synthesize({ text: "hello", language: "en" }, {
      auth, signal: controller.signal, fetch: async () => { called = true; return new Response(); },
    }))).rejects.toBe(failure);
    expect(called).toBe(false);
  });

  test("Bun native WebSocket authenticates and synthesizes without a socket override", async () => {
    const received: { authorization: string | null; url: string } = { authorization: null, url: "" };
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request, server) {
        received.authorization = request.headers.get("authorization");
        received.url = request.url;
        if (server.upgrade(request)) return;
        return new Response(null, { status: 400 });
      },
      websocket: {
        message(socket, data) {
          const message = JSON.parse(String(data)) as Record<string, unknown>;
          if (message.type === "session.update") socket.send(JSON.stringify({ type: "session.updated", replace: message.replace }));
          if (message.type === "text.clear") socket.send(JSON.stringify({ type: "audio.clear" }));
          if (message.type === "text.done") {
            socket.send(JSON.stringify({ type: "audio.delta", delta: "AQI=" }));
            socket.send(JSON.stringify({ type: "audio.done" }));
          }
        },
      },
    });
    try {
      const result = await Array.fromAsync(synthesize({ text: (async function* () {
        yield { command: "update", replacements: [] } as const;
        yield "old";
        yield { command: "clear" } as const;
        yield "new";
      })() }, { auth, webSocketUrl: `ws://127.0.0.1:${server.port}/v1/tts`, signal: AbortSignal.timeout(3000) }));
      expect(received.authorization).toBe("Bearer test-key");
      expect(received.url).not.toContain("test-key");
      expect(new URL(received.url).searchParams.get("language")).toBe("auto");
      expect(result).toEqual([{ event: "updated", replacements: [] }, { event: "clear" }, Uint8Array.of(1, 2), { event: "done" }]);
    } finally { await server.stop(true); }
  });
});
