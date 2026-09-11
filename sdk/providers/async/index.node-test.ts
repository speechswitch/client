import { describe, test } from "node:test";
import { expect } from "expect";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { validateRequest } from "../../generated/validators/async.ts";
import { synthesize, synthesizeWithTimestamps, type TtsRequest } from "./index.ts";
import {
  synthesize as dispatch,
  synthesizeWithTimestamps as dispatchTimestamps,
} from "../../dispatch.ts";
import type { TtsRequest as AmazonRequest } from "../../../schemas/providers/amazon/index.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import type { WebSocketLike } from "../../websocket.ts";

const request = {
  voice: "existing-custom-voice",
  model: "castleflow-1.0",
  output: { container: "raw", codec: "pcm", sampleRateHz: 44100 },
} as const;
const auth = { async: { apiKey: "test-key" } } as const;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Adapter tests compare the complete generated diagnostic, not a duplicated union.
function validationError(request: unknown): TypeError {
  try {
    validateRequest(request);
  } catch (error) {
    assert(error instanceof TypeError);
    return error;
  }
  assert.fail("Expected the generated validator to reject this request");
}

test("generated checks reject legacy controls on newer models before HTTP", async () => {
  let called = false;
  const invalid = { ...request, model: "flash_v1.5", text: "hello", speed: 1 } as const;
  // @ts-expect-error Flash has no speed setting; untyped callers are checked at the same boundary.
  const stream = synthesize(invalid, {
    auth,
    fetch: async () => {
      called = true;
      return new Response();
    },
  });
  await expect(stream.next()).rejects.toEqual(validationError(invalid));
  expect(called).toBe(false);
});

test("generated bounds reject out-of-range sample rates before HTTP", async () => {
  let called = false;
  const invalid = {
    ...request,
    text: "hello",
    output: { container: "raw", codec: "pcm", sampleRateHz: 48001 },
  } as const;
  await expect(
    synthesize(invalid, {
      auth,
      fetch: async () => {
        called = true;
        return new Response();
      },
    }).next(),
  ).rejects.toEqual(validationError(invalid));
  expect(called).toBe(false);
});

test("the schema rejects fractional wire sample rates", async () => {
  const invalid = {
    ...request,
    text: "hello",
    output: { container: "raw", codec: "pcm", sampleRateHz: 24000.5 },
  } as const;
  await expect(
    synthesize(invalid, {
      auth,
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
    }).next(),
  ).rejects.toEqual(validationError(invalid));
});

class Socket implements WebSocketLike {
  readyState = 1;
  binaryType = "blob";
  readonly sent: Record<string, unknown>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  closes = 0;
  onSend: (message: Record<string, unknown>) => void = () => {};
  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (this.readyState !== 1) throw new TypeError("send on a closed socket");
    const message = JSON.parse(String(data));
    this.sent.push(message);
    this.onSend(message);
  }
  close() {
    this.closes++;
    this.readyState = 3;
    this.emit("close", {});
  }
  addEventListener(type: string, listener: (event: any) => void) {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
  }
  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, value: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }
  receive(value: unknown) {
    this.emit("message", { data: JSON.stringify(value) });
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, values) => sum + values.size, 0);
  }
}

function stalledInput() {
  let calls = 0;
  let returns = 0;
  let release!: (value: IteratorResult<string>) => void;
  const input: AsyncIterableIterator<string> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      calls++;
      if (calls === 1) return Promise.resolve({ value: "hello", done: false });
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    async return() {
      returns++;
      return { value: undefined, done: true };
    },
  };
  return { input, release: () => release({ value: "late", done: false }), returns: () => returns };
}

function respondToText(socket: Socket) {
  socket.onSend = (message) => {
    if (message.transcript)
      queueMicrotask(() =>
        socket.receive({ context_id: message.context_id, audio: "AQI=", final: false }),
      );
  };
}

test("generated input checks reject unsupported controls and close the socket", async () => {
  const socket = new Socket();
  const text = (async function* () {
    yield { command: "clear" };
  })() as unknown as AsyncIterable<string>;
  await expect(
    synthesize({ ...request, text }, { auth, webSocket: socket }).next(),
  ).rejects.toEqual(new TypeError("Invalid async TTS input item:\ntext item: expected string"));
  expect(socket.sent).toEqual([
    {
      model_id: "async_flash_v1.0",
      voice: { mode: "id", id: "existing-custom-voice" },
      output_format: { container: "raw", sample_rate: 44100, encoding: "pcm_s16le" },
    },
  ]);
  expect(socket.closes).toBe(1);
});

describe("Async HTTP", () => {
  test("streams byte-native output immediately and selects an existing custom voice", async () => {
    let end!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2));
        end = () => controller.close();
      },
    });
    const fetch: Fetch = async (url, init) => {
      expect(String(url)).toBe("https://api.async.com/text_to_speech/streaming");
      expect(init?.headers).toEqual({
        "x-api-key": "test-key",
        version: "v1",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        model_id: "async_flash_v1.0",
        transcript: "Hello",
        voice: { mode: "id", id: "existing-custom-voice" },
        output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 44100 },
        stability: 42,
        speed_control: 1.1,
        language: "fr",
      });
      return new Response(body);
    };
    const stream = synthesize(
      { ...request, text: "Hello", stability: 0.42, speed: 1.1, language: "fr" },
      { auth, fetch },
    );
    expect((await stream.next()).value).toEqual(Uint8Array.of(1, 2));
    end();
    expect((await stream.next()).done).toBe(true);
  });

  test("uses the full HTTP endpoint for WAV without buffering in the SDK", async () => {
    const fetch: Fetch = async (url, init) => {
      expect(String(url)).toBe("https://proxy.invalid/text_to_speech");
      expect(JSON.parse(String(init?.body)).output_format).toEqual({
        container: "wav",
        encoding: "pcm_f32le",
        sample_rate: 22050,
      });
      return new Response(Uint8Array.of(7));
    };
    expect(
      await Array.fromAsync(
        synthesize(
          {
            ...request,
            text: "hello",
            output: {
              container: "wav",
              codec: "pcm",
              sampleRateHz: 22050,
              sampleFormat: "float32",
            },
          },
          { auth, fetch, baseUrl: "https://proxy.invalid" },
        ),
      ),
    ).toEqual([Uint8Array.of(7)]);
  });

  for (const [output, expected] of [
    [
      { codec: "mp3", sampleRateHz: 48000, bitRateBps: 320000 },
      { container: "mp3", sample_rate: 48000, bit_rate: 320000 },
    ],
    [
      { container: "raw", codec: "mulaw", sampleRateHz: 8000 },
      { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 },
    ],
    [
      { container: "raw", codec: "pcm", sampleRateHz: 16000, sampleFormat: "float32" },
      { container: "raw", encoding: "pcm_f32le", sample_rate: 16000 },
    ],
  ] as const)
    test("maps output %j", async () => {
      const fetch: Fetch = async (_url, init) => {
        expect(JSON.parse(String(init?.body)).output_format).toEqual(expected);
        return new Response(Uint8Array.of(1));
      };
      await Array.fromAsync(synthesize({ ...request, text: "hello", output }, { auth, fetch }));
    });

  test("keeps native audio/word association through the timestamp operation", async () => {
    const fetch: Fetch = async (url) => {
      expect(String(url)).toBe("https://api.async.com/text_to_speech/with_timestamps");
      return Response.json({
        audio_base64: "AQI=",
        alignment: {
          words: ["hello"],
          word_start_times_milliseconds: [10],
          word_end_times_milliseconds: [50],
        },
      });
    };
    expect(
      await Array.fromAsync(
        dispatchTimestamps(
          "async",
          { ...request, text: "hello", timestampGranularity: "word" },
          { auth, fetch },
        ),
      ),
    ).toEqual([
      {
        correlation: "chunk",
        audio: Uint8Array.of(1, 2),
        timestamps: [{ kind: "word", value: "hello", startTimeMs: 10, endTimeMs: 50 }],
      },
    ]);
  });

  for (const [alignment, message] of [
    [
      { words: ["hello"], word_start_times_milliseconds: [], word_end_times_milliseconds: [1] },
      "Async returned mismatched word timestamp arrays",
    ],
    [
      { words: ["hello"], word_start_times_milliseconds: [4], word_end_times_milliseconds: [1] },
      "Async returned an invalid word timestamp",
    ],
    [
      { words: [42], word_start_times_milliseconds: [0], word_end_times_milliseconds: [1] },
      "Async returned an invalid word timestamp",
    ],
  ] as const)
    test("rejects invalid timestamps %j", async () => {
      await expect(
        Array.fromAsync(
          synthesizeWithTimestamps(
            { ...request, text: "hello", timestampGranularity: "word" },
            {
              auth,
              fetch: async () => Response.json({ audio_base64: "AQ==", alignment }),
            },
          ),
        ),
      ).rejects.toEqual(new TypeError(message));
    });

  test("detects a quota marker split at every byte boundary", async () => {
    const marker = new TextEncoder().encode("--ERROR:QUOTA_EXCEEDED--");
    for (let split = 1; split < marker.length; split++) {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1, 2));
          controller.enqueue(marker.slice(0, split));
          controller.enqueue(marker.slice(split));
        },
        cancel() {
          cancelled = true;
        },
      });
      const stream = synthesize(
        { ...request, text: "hello" },
        { auth, fetch: async () => new Response(body) },
      );
      expect((await stream.next()).value).toEqual(Uint8Array.of(1, 2));
      await expect(stream.next()).rejects.toEqual(new TypeError("Async streaming quota exceeded"));
      expect(cancelled).toBe(true);
    }
  });

  test("does not discard an incomplete marker at EOF", async () => {
    const bytes = new TextEncoder().encode("audio--ERROR:");
    const values = await Array.fromAsync(
      synthesize({ ...request, text: "hello" }, { auth, fetch: async () => new Response(bytes) }),
    );
    expect(values).toEqual([
      new TextEncoder().encode("audio"),
      new TextEncoder().encode("--ERROR:"),
    ]);
  });

  test("cancels the HTTP body when the consumer exits early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const stream = synthesize(
      { ...request, text: "hello" },
      { auth, fetch: async () => new Response(body) },
    );
    await stream.next();
    await stream.return!();
    expect(cancelled).toBe(true);
  });

  test("rejects HTTP failures with provider context", async () => {
    await expect(
      Array.fromAsync(
        synthesize(
          { ...request, text: "hello" },
          { auth, fetch: async () => new Response("invalid voice", { status: 400 }) },
        ),
      ),
    ).rejects.toEqual(new TypeError("Async returned HTTP 400: invalid voice"));
  });

  test("honors abort before any request and forwards a live signal to fetch", async () => {
    let called = false;
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    await expect(
      synthesize(
        { ...request, text: "hello" },
        {
          auth,
          signal: controller.signal,
          fetch: async () => {
            called = true;
            return new Response();
          },
        },
      ).next(),
    ).rejects.toBe(reason);
    expect(called).toBe(false);
    const live = new AbortController();
    const stream = synthesize(
      { ...request, text: "hello" },
      {
        auth,
        signal: live.signal,
        fetch: async (_url, init) => {
          expect(init?.signal?.aborted).toBe(false);
          return new Response(Uint8Array.of(1));
        },
      },
    );
    await stream.next();
    live.abort(reason);
    await expect(stream.next()).rejects.toBe(reason);
  });
});

describe("Async WebSocket lifecycle", () => {
  test("uses an already-open socket, consumes incremental text, and preserves final-frame audio", async () => {
    const socket = new Socket();
    socket.onSend = (message) => {
      if (message.close_context)
        socket.receive({ context_id: message.context_id, audio: "AQI=", final: true });
    };
    async function* text() {
      yield "hello\n";
      yield "world";
    }
    const values = await Array.fromAsync(
      synthesize(
        { ...request, text: text(), segmentation: "immediate" },
        { auth, webSocket: socket },
      ),
    );
    expect(values).toEqual([Uint8Array.of(1, 2)]);
    expect(
      socket.sent
        .slice(1)
        .map(({ transcript, force, close_context }) => ({ transcript, force, close_context })),
    ).toEqual([
      { transcript: "hello ", force: true, close_context: undefined },
      { transcript: "world ", force: true, close_context: undefined },
      { transcript: "", force: undefined, close_context: true },
    ]);
    expect(socket.closes).toBe(1);
    expect(socket.listenerCount).toBe(0);
  });

  test("stopping consumption returns a stalled source and never sends its late value", async () => {
    const socket = new Socket();
    respondToText(socket);
    const source = stalledInput();
    const stream = synthesize({ ...request, text: source.input }, { auth, webSocket: socket });
    await stream.next();
    await stream.return!();
    const sent = socket.sent.length;
    source.release();
    await tick();
    expect(source.returns()).toBe(1);
    expect(socket.sent.length).toBe(sent);
    expect(socket.closes).toBe(1);
    expect(socket.listenerCount).toBe(0);
  });

  test("abort while input is stalled rejects pending output and stops the producer", async () => {
    const socket = new Socket();
    respondToText(socket);
    const source = stalledInput();
    const controller = new AbortController();
    const stream = synthesize(
      { ...request, text: source.input },
      { auth, webSocket: socket, signal: controller.signal },
    );
    await stream.next();
    const next = stream.next();
    const reason = new Error("barge in");
    controller.abort(reason);
    await expect(next).rejects.toBe(reason);
    source.release();
    await tick();
    expect(source.returns()).toBe(1);
    expect(socket.sent.length).toBe(2);
    expect(socket.listenerCount).toBe(0);
  });

  test("abort while the consumer is paused closes the socket immediately", async () => {
    const socket = new Socket();
    respondToText(socket);
    const source = stalledInput();
    const controller = new AbortController();
    const stream = synthesize(
      { ...request, text: source.input },
      { auth, webSocket: socket, signal: controller.signal },
    );
    await stream.next();
    controller.abort();
    expect(socket.closes).toBe(1);
    expect(source.returns()).toBe(1);
    source.release();
    await expect(stream.next()).rejects.toHaveProperty("name", "AbortError");
  });

  test("abort while opening does not start input consumption", async () => {
    const socket = new Socket();
    socket.readyState = 0;
    const controller = new AbortController();
    let started = false;
    async function* text() {
      started = true;
      yield "hello";
    }
    const next = synthesize(
      { ...request, text: text() },
      { auth, webSocket: socket, signal: controller.signal },
    ).next();
    controller.abort();
    await expect(next).rejects.toHaveProperty("name", "AbortError");
    expect(started).toBe(false);
    expect(socket.closes).toBe(1);
    expect(socket.listenerCount).toBe(0);
  });

  test("rejects a prematurely closed socket without waiting for stalled input", async () => {
    const socket = new Socket();
    respondToText(socket);
    const source = stalledInput();
    const stream = synthesize({ ...request, text: source.input }, { auth, webSocket: socket });
    await stream.next();
    const next = stream.next();
    socket.close();
    await expect(next).rejects.toThrow("before final output");
    expect(source.returns()).toBe(1);
    source.release();
  });

  for (const mode of ["wrong-context", "early-final", "provider-error", "malformed"])
    test(`rejects ${mode} and stops input`, async () => {
      const socket = new Socket();
      socket.onSend = (message) => {
        if (!message.transcript) return;
        const value =
          mode === "provider-error"
            ? { error_code: "INVALID_VOICE", message: "no voice" }
            : mode === "malformed"
              ? { audio: 42 }
              : {
                  context_id: mode === "wrong-context" ? "wrong" : message.context_id,
                  audio: "",
                  final: true,
                };
        queueMicrotask(() => socket.receive(value));
      };
      const source = stalledInput();
      await expect(
        synthesize({ ...request, text: source.input }, { auth, webSocket: socket }).next(),
      ).rejects.toThrow();
      expect(source.returns()).toBe(1);
      expect(socket.listenerCount).toBe(0);
      source.release();
    });

  test("input failure terminates a silent server", async () => {
    const socket = new Socket();
    const reason = new Error("producer failed");
    async function* text() {
      yield "hello";
      throw reason;
    }
    await expect(
      synthesize({ ...request, text: text() }, { auth, webSocket: socket }).next(),
    ).rejects.toBe(reason);
    expect(socket.closes).toBe(1);
    expect(socket.listenerCount).toBe(0);
  });

  test("an iterator-construction failure closes the opened socket", async () => {
    const socket = new Socket();
    const reason = new Error("cannot create iterator");
    const text: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        throw reason;
      },
    };
    await expect(synthesize({ ...request, text }, { auth, webSocket: socket }).next()).rejects.toBe(
      reason,
    );
    expect(socket.closes).toBe(1);
    expect(socket.listenerCount).toBe(0);
  });

  test("a producer's return rejection cannot leak an unhandled promise", async () => {
    const socket = new Socket();
    respondToText(socket);
    const source = stalledInput();
    source.input.return = async () => {
      throw new Error("cleanup failed");
    };
    const stream = synthesize({ ...request, text: source.input }, { auth, webSocket: socket });
    await stream.next();
    await stream.return!();
    source.release();
    await tick();
    expect(socket.closes).toBe(1);
  });

  test("empty input does not await an unused context's final event", async () => {
    const socket = new Socket();
    async function* text() {
      yield "";
    }
    expect(
      await Array.fromAsync(synthesize({ ...request, text: text() }, { auth, webSocket: socket })),
    ).toEqual([]);
    expect(socket.sent).toHaveLength(1);
    expect(socket.closes).toBe(1);
  });
});

test("capabilities remain narrow at provider and dispatch call sites", () => {
  async function* strings() {
    yield "hello";
  }
  async function* commands() {
    yield { command: "clear" } as const;
  }
  const valid: TtsRequest = { ...request, text: strings() };
  const validText: AsyncIterable<string> = valid.text;
  void validText;
  // @ts-expect-error Async has no documented clear command.
  const clear: TtsRequest = { ...request, text: commands() };
  // @ts-expect-error Timestamps are not supported for incremental input.
  const timestamps: TtsRequest = { ...request, text: strings(), timestampGranularity: "word" };
  // @ts-expect-error WAV is not supported by the WebSocket protocol.
  const wav: TtsRequest = {
    ...request,
    text: strings(),
    output: { container: "wav", codec: "pcm", sampleRateHz: 24000 },
  };
  // @ts-expect-error Newer models do not support the legacy speed setting.
  const speed: TtsRequest = { ...request, model: "flash_v1.5", text: "hello", speed: 1 };
  // @ts-expect-error Pro only supports English.
  const language: TtsRequest = { ...request, model: "pro_v1.0", text: "hello", language: "fr" };
  // @ts-expect-error Timestamp endpoint does not support mulaw.
  const mulaw: TtsRequest = {
    ...request,
    text: "hello",
    timestampGranularity: "word",
    output: { container: "raw", codec: "mulaw", sampleRateHz: 8000 },
  };
  // @ts-expect-error Dispatch must not widen Async's command support.
  dispatch("async", { ...request, text: commands() }, { auth });
  const amazon: AmazonRequest = {
    // @ts-expect-error Amazon remains narrower than the normalized command iterable.
    text: commands(),
    voice: "Joanna",
    model: "generative",
    language: "en-US",
    output: { codec: "mp3", sampleRateHz: 24000 },
  };
  const amazonStream = dispatch("amazon", {
    text: strings(),
    voice: "Joanna",
    model: "generative",
    output: { codec: "mp3", sampleRateHz: 24000 },
  });
  const amazonAudio: AsyncIterableIterator<Uint8Array> = amazonStream;
  const asyncAudio: AsyncIterableIterator<Uint8Array> = dispatch(
    "async",
    { ...request, text: strings() },
    { auth },
  );
  void [amazonAudio, asyncAudio];
  void [clear, timestamps, wav, speed, language, mulaw, amazon];
});

test("the authored provider bundles for browsers without Node runtime shims", async () => {
  const text = execFileSync(
    "bun",
    ["build", new URL("index.ts", import.meta.url).pathname, "--target=browser"],
    { encoding: "utf8" },
  );
  expect(text).not.toContain("node:");
  expect(text).not.toContain("stdout");
  expect(text).not.toContain("_handle");
});

test("auth resolves explicit, namespaced, then provider environment keys", async () => {
  const namespaced = process.env.SPEECHSWITCH_ASYNC_API_KEY;
  const provider = process.env.ASYNC_API_KEY;
  const authorizations: (string | null)[] = [];
  const fetch: Fetch = async (_url, init) => {
    authorizations.push(new Headers(init?.headers).get("x-api-key"));
    return new Response(Uint8Array.of(1));
  };
  const input = { ...request, text: "hello" };
  try {
    process.env.SPEECHSWITCH_ASYNC_API_KEY = "namespaced-test-key";
    process.env.ASYNC_API_KEY = "provider-test-key";
    await Array.fromAsync(synthesize(input, { auth, fetch }));
    await Array.fromAsync(synthesize(input, { fetch }));
    delete process.env.SPEECHSWITCH_ASYNC_API_KEY;
    await Array.fromAsync(synthesize(input, { fetch }));
    delete process.env.ASYNC_API_KEY;
    await expect(Array.fromAsync(synthesize(input, { fetch }))).rejects.toThrow(
      "Missing auth.async.apiKey configuration",
    );
    expect(authorizations).toEqual(["test-key", "namespaced-test-key", "provider-test-key"]);
  } finally {
    if (namespaced === undefined) delete process.env.SPEECHSWITCH_ASYNC_API_KEY;
    else process.env.SPEECHSWITCH_ASYNC_API_KEY = namespaced;
    if (provider === undefined) delete process.env.ASYNC_API_KEY;
    else process.env.ASYNC_API_KEY = provider;
  }
});
