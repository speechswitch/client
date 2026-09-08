import { expect } from "expect";
import { describe, test } from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import type { Fetch } from "../../runtime/fetch.ts";
import { FakeWebSocket } from "../../../test-support/fake-websocket.ts";
import { synthesize as dispatchSynthesize } from "../../dispatch.ts";
import { synthesize, synthesizeWithTimestamps, voice, voices } from "./index.ts";
import { validateInputItem as validateAmazonInputItem } from "../../generated/validators/amazon.ts";
import { validateRequest, validateInputItem } from "../../generated/validators/xai.ts";

async function serve(upgrade: (request: IncomingMessage, socket: Duplex) => void) {
  const sockets = new Set<Duplex>();
  const server = createServer();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", upgrade);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new TypeError("Expected a TCP server address");
  return {
    url: `ws://127.0.0.1:${address.port}/v1/tts`,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

function accept(
  request: IncomingMessage,
  socket: Duplex,
  receive: (message: Record<string, unknown>) => void,
) {
  const key = createHash("sha1")
    .update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`,
  );
  let pending: Buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const opcode = pending[0]! & 15;
      const lengthCode = pending[1]! & 127;
      /* client frames are masked */ expect(pending[1]! & 128).toBe(128);
      /* test frames fit in 16-bit lengths */ expect(lengthCode).not.toBe(127);
      if (pending.length < (lengthCode === 126 ? 4 : 2)) return;
      const length = lengthCode === 126 ? pending.readUInt16BE(2) : lengthCode;
      const maskOffset = lengthCode === 126 ? 4 : 2;
      const offset = maskOffset + 4;
      if (pending.length < offset + length) return;
      const payload = Buffer.from(pending.subarray(offset, offset + length));
      for (let index = 0; index < length; index++)
        payload[index] = payload[index]! ^ pending[maskOffset + (index % 4)]!;
      pending = pending.subarray(offset + length);
      if (opcode === 8) {
        socket.end(Buffer.from([0x88, 0]));
        return;
      }
      expect(opcode).toBe(1);
      receive(JSON.parse(payload.toString()));
    }
  });
}

function send(socket: Duplex, value: object) {
  const payload = Buffer.from(JSON.stringify(value));
  expect(payload.length).toBeLessThan(65536);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  socket.write(Buffer.concat([header, payload]));
}

function xaiSocket() {
  const socket = new FakeWebSocket();
  socket.onSend = (data) => {
    const message = JSON.parse(String(data)) as Record<string, unknown>;
    queueMicrotask(() => {
      if (message.type === "session.update")
        socket.emit("message", {
          data: JSON.stringify({ type: "session.updated", replace: message.replace }),
        });
      if (message.type === "text.clear")
        socket.emit("message", { data: JSON.stringify({ type: "audio.clear" }) });
      if (message.type === "text.done") {
        socket.emit("message", { data: JSON.stringify({ type: "audio.delta", delta: "AQI=" }) });
        socket.emit("message", { data: JSON.stringify({ type: "audio.done" }) });
      }
    });
  };
  return socket;
}

const auth = { xai: { apiKey: "test-key" } } as const;

describe("xAI TTS", () => {
  test("omitted and undefined language resolve to auto while explicit language is preserved", async () => {
    for (const request of [
      { text: "hello" },
      { text: "hello", language: undefined },
      { text: "hello", language: "fr" as const },
    ]) {
      let language: unknown;
      await Array.fromAsync(
        synthesize(request, {
          auth,
          fetch: async (_url, init) => {
            language = JSON.parse(String(init?.body)).language;
            return new Response(Uint8Array.of(1));
          },
        }),
      );
      expect(language).toBe(request.language ?? "auto");
    }
  });

  test("uses byte-native REST synthesis for string input", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(1, 2, 3));
    };
    expect(
      await Array.fromAsync(
        synthesize(
          {
            text: "hello",
            voice: "eve",
            model: "grok-tts",
            language: "en",
            output: { format: "mp3", sampleRateHz: 24000, bitRateBps: 128000 },
            speed: 1.1,
            textNormalization: true,
            latencyOptimization: "aggressive",
            replacements: [{ pattern: "xAI", replacement: "X A I" }],
          },
          { auth, fetch },
        ),
      ),
    ).toStrictEqual([Uint8Array.of(1, 2, 3)]);
    expect(url).toBe("https://api.x.ai/v1/tts");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toStrictEqual({
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
    const socket = xaiSocket();
    const audio = await Array.fromAsync(
      synthesize(
        {
          text: (async function* () {
            yield "hel";
            yield "lo";
          })(),
          language: "en",
        },
        { auth, webSocket: socket },
      ),
    );
    expect(audio).toStrictEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent.map((value) => JSON.parse(String(value)))).toStrictEqual([
      { type: "text.delta", delta: "hel" },
      { type: "text.delta", delta: "lo" },
      { type: "text.done" },
    ]);
  });

  test("passes clear commands through while yielding only audio", async () => {
    const socket = xaiSocket();
    const output = await Array.fromAsync(
      synthesize(
        {
          text: (async function* () {
            yield "first";
            yield { command: "clear" } as const;
            yield "replacement";
          })(),
          language: "en",
        },
        { auth, webSocket: socket },
      ),
    );

    expect(output).toStrictEqual([Uint8Array.of(1, 2)]);
    expect(socket.sent.map((value) => JSON.parse(String(value)))).toStrictEqual([
      { type: "text.delta", delta: "first" },
      { type: "text.clear" },
      { type: "text.delta", delta: "replacement" },
      { type: "text.done" },
    ]);
  });

  test("preserves native character-to-audio chunk correlation", async () => {
    const fetch: Fetch = async () =>
      Response.json({
        audio: "AwQ=",
        content_type: "audio/mpeg",
        duration: 0.2,
        audio_timestamps: {
          graph_chars: ["H", "i"],
          graph_times: [
            [0, 0.1],
            [0.1, 0.2],
          ],
        },
      });
    expect(
      await Array.fromAsync(
        synthesizeWithTimestamps(
          { text: "Hi", language: "en" },
          {
            auth,
            fetch,
          },
        ),
      ),
    ).toStrictEqual([
      {
        correlation: "chunk",
        audio: Uint8Array.of(3, 4),
        durationMs: 200,
        timestamps: [
          { kind: "character", value: "H", startTimeMs: 0, endTimeMs: 100 },
          { kind: "character", value: "i", startTimeMs: 100, endTimeMs: 200 },
        ],
      },
    ]);
  });

  test("exposes voice operations", async () => {
    const fetch: Fetch = async (input) =>
      String(input).endsWith("/voices")
        ? Response.json({ voices: [{ voice_id: "eve", name: "Eve", language: "en" }] })
        : Response.json({ voice_id: "eve", name: "Eve", language: "en" });
    expect(await voices({ auth, fetch })).toHaveLength(1);
    expect(await voice("eve", { auth, fetch })).toMatchObject({ voice_id: "eve" });
  });

  test("updates and removes the replacement map, exposing the actual server echo", async () => {
    const socket = xaiSocket();
    socket.onSend = (data) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      if (message.type === "session.update")
        socket.emit("message", {
          data: JSON.stringify({ type: "session.updated", replace: { echoed: "from server" } }),
        });
    };
    const result = await Array.fromAsync(
      synthesizeWithTimestamps(
        {
          language: "en",
          replacements: [{ pattern: "first", replacement: "initial" }],
          text: (async function* () {
            yield {
              command: "update",
              replacements: [{ pattern: "Acme Mobile", replacement: "Acme Mobull" }],
            } as const;
            yield { command: "update", replacements: [] } as const;
          })(),
        },
        { auth, webSocket: socket },
      ),
    );
    expect(socket.sent.map((value) => JSON.parse(String(value)))).toStrictEqual([
      { type: "session.update", replace: { first: "initial" } },
      { type: "session.update", replace: { "Acme Mobile": "Acme Mobull" } },
      { type: "session.update", replace: {} },
    ]);
    expect(result).toStrictEqual(
      Array.from({ length: 3 }, () => ({
        event: "updated",
        replacements: [{ pattern: "echoed", replacement: "from server" }],
      })),
    );
    expect(socket.closed).toBe(true);
  });

  test("flush ends an utterance, not the input iterator or connection", async () => {
    const socket = xaiSocket();
    let awaitingDone = false;
    let turn = 0;
    socket.onSend = (data) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      if (message.type === "text.delta") expect(awaitingDone).toBe(false);
      if (message.type === "session.update")
        socket.emit("message", {
          data: JSON.stringify({ type: "session.updated", replace: message.replace }),
        });
      if (message.type === "text.done") {
        awaitingDone = true;
        setTimeout(() => {
          awaitingDone = false;
          socket.emit("message", { data: JSON.stringify({ type: "audio.delta", delta: "AQI=" }) });
          socket.emit("message", {
            data: JSON.stringify({ type: "audio.done", trace_id: `turn-${++turn}` }),
          });
        }, 5);
      }
    };
    const replacements = [{ pattern: "Acme", replacement: "Ack me" }];
    const result = await Array.fromAsync(
      synthesizeWithTimestamps(
        {
          language: "en",
          text: (async function* () {
            yield "first";
            yield { command: "flush" } as const;
            yield { command: "update", replacements } as const;
            yield "second";
            yield { command: "flush" } as const;
          })(),
        },
        { auth, webSocket: socket },
      ),
    );
    expect(result.filter((value) => "event" in value)).toStrictEqual([
      { event: "updated", replacements },
      { event: "done", traceId: "turn-1" },
      { event: "done", traceId: "turn-2" },
    ]);
    expect(socket.sent.map((value) => JSON.parse(String(value)))).toStrictEqual([
      { type: "text.delta", delta: "first" },
      { type: "text.done" },
      { type: "session.update", replace: { Acme: "Ack me" } },
      { type: "text.delta", delta: "second" },
      { type: "text.done" },
    ]);
  });

  test("clear cancels a flushing utterance and waits for ACK before new text", async () => {
    const socket = xaiSocket();
    let cleared = false;
    let dones = 0;
    socket.onSend = (data) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      if (message.type === "text.clear") {
        socket.emit("message", { data: JSON.stringify({ type: "audio.delta", delta: "AwQ=" }) });
        socket.emit("message", {
          data: JSON.stringify({ type: "audio.done", trace_id: "cancelled" }),
        });
        setTimeout(() => {
          cleared = true;
          socket.emit("message", { data: JSON.stringify({ type: "audio.clear" }) });
        }, 5);
      }
      if (message.type === "text.delta" && message.delta === "second") expect(cleared).toBe(true);
      if (message.type === "text.done" && ++dones === 2) {
        socket.emit("message", { data: JSON.stringify({ type: "audio.delta", delta: "AQI=" }) });
        socket.emit("message", { data: JSON.stringify({ type: "audio.done" }) });
      }
    };
    const result = await Array.fromAsync(
      synthesize(
        {
          language: "en",
          text: (async function* () {
            yield "first";
            yield { command: "flush" } as const;
            yield { command: "clear" } as const;
            yield "second";
          })(),
        },
        { auth, webSocket: socket },
      ),
    );
    expect(result).toStrictEqual([Uint8Array.of(1, 2)]);
  });

  test("empty and clear-only iterators finish without waiting for nonexistent audio", async () => {
    for (const clear of [false, true]) {
      const socket = xaiSocket();
      const result = await Array.fromAsync(
        synthesize(
          {
            language: "en",
            text: (async function* () {
              yield "";
              yield { command: "flush" } as const;
              if (clear) yield { command: "clear" } as const;
            })(),
          },
          { auth, webSocket: socket },
        ),
      );
      expect(result).toStrictEqual([]);
      expect(socket.closed).toBe(true);
    }
  });

  test("propagates iterator failure while output is idle", async () => {
    const socket = xaiSocket();
    const failure = new Error("input failed");
    const result = Array.fromAsync(
      synthesize(
        {
          language: "en",
          text: (async function* () {
            yield "first";
            throw failure;
          })(),
        },
        { auth, webSocket: socket },
      ),
    );
    await expect(result).rejects.toBe(failure);
    expect(socket.closed).toBe(true);
  });

  test("abort releases a stalled producer without awaiting its return", async () => {
    const socket = xaiSocket();
    const controller = new AbortController();
    let returned = false;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const text: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          started();
          return new Promise(() => {});
        },
        return: () => {
          returned = true;
          return new Promise(() => {});
        },
      }),
    };
    const result = Array.fromAsync(
      synthesize({ language: "en", text }, { auth, webSocket: socket, signal: controller.signal }),
    );
    await ready;
    const failure = new Error("cancelled");
    controller.abort(failure);
    await expect(result).rejects.toBe(failure);
    expect(returned).toBe(true);
    expect(socket.closed).toBe(true);
  });

  test("early consumer return cleans up input and socket", async () => {
    const socket = xaiSocket();
    socket.onSend = (data) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      if (message.type === "text.delta")
        socket.emit("message", { data: JSON.stringify({ type: "audio.delta", delta: "AQI=" }) });
    };
    let returned = false;
    const text: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: "text" }),
        return: async () => {
          returned = true;
          return { done: true, value: undefined };
        },
      }),
    };
    for await (const _ of synthesize({ language: "en", text }, { auth, webSocket: socket })) break;
    expect(returned).toBe(true);
    expect(socket.closed).toBe(true);
  });

  test("schema-derived checks retain provider-specific command narrowing", () => {
    const text = (async function* () {
      yield "hello";
    })();
    const xai = { text, language: "en" };
    const amazon = {
      text,
      voice: "Joanna",
      model: "generative",
      output: { format: "mp3" },
    };
    for (const command of [
      { command: "update", replacements: [] },
      { command: "flush" },
      { command: "clear" },
    ]) {
      expect(() => validateInputItem(xai, command)).not.toThrow();
      expect(() => validateAmazonInputItem(amazon, command)).toThrow();
    }
    expect(() => validateInputItem(xai, { command: "update" })).toThrow();
    expect(() =>
      validateInputItem(xai, {
        command: "update",
        replacements: [{ pattern: "Acme", replacement: 123 }],
      }),
    ).toThrow();
    expect(() => validateInputItem(xai, { command: "unknown" })).toThrow();
    expect(() => validateRequest({ text, language: "en", speed: 2 })).toThrow();
    expect(() =>
      validateRequest({ text, language: "en", output: { format: "pcm", bitRateBps: 128000 } }),
    ).toThrow();
    expect(() =>
      validateRequest({ text, language: "en", output: { format: "pcm", sampleRateHz: 48000 } }),
    ).not.toThrow();
  });

  test("rejects equivalent replacement phrases instead of silently overwriting", async () => {
    const replacements = [
      { pattern: "Acme  Mobile", replacement: "one" },
      { pattern: " ACME Mobile ", replacement: "two" },
    ];
    let called = false;
    await expect(
      Array.fromAsync(
        synthesize(
          { text: "hello", language: "en", replacements },
          {
            auth,
            fetch: async () => {
              called = true;
              return new Response();
            },
          },
        ),
      ),
    ).rejects.toThrow(/Duplicate xAI replacement phrase/);
    expect(called).toBe(false);
    const socket = xaiSocket();
    await expect(
      Array.fromAsync(
        synthesize(
          {
            language: "en",
            text: (async function* () {
              yield { command: "update", replacements } as const;
            })(),
          },
          { auth, webSocket: socket },
        ),
      ),
    ).rejects.toThrow(/Duplicate xAI replacement phrase/);
    expect(socket.sent).toStrictEqual([]);
    expect(socket.closed).toBe(true);
  });

  test("rejects malformed ACKs and early socket closure", async () => {
    for (const malformed of [true, false]) {
      const socket = xaiSocket();
      socket.onSend = (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message.type === "session.update") {
          if (malformed)
            socket.emit("message", {
              data: JSON.stringify({ type: "session.updated", replace: { invalid: 42 } }),
            });
          else socket.emit("close", {});
        }
      };
      await expect(
        Array.fromAsync(
          synthesize(
            { language: "en", replacements: [], text: (async function* () {})() },
            {
              auth,
              webSocket: socket,
            },
          ),
        ),
      ).rejects.toThrow(malformed ? /replacement map/ : /closed before/);
    }
  });

  test("streaming timestamps retain native chunk duration and substituted characters", async () => {
    const socket = xaiSocket();
    socket.onSend = (data) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      if (message.type === "text.done") {
        socket.emit("message", {
          data: JSON.stringify({
            type: "audio.delta",
            delta: "AQI=",
            audio_duration: 0.25,
            audio_timestamps: { graph_chars: ["X"], graph_times: [[0.05, 0.2]] },
          }),
        });
        socket.emit("message", {
          data: JSON.stringify({ type: "audio.done", trace_id: "native-trace" }),
        });
      }
    };
    expect(
      await Array.fromAsync(
        synthesizeWithTimestamps(
          {
            language: "en",

            text: (async function* () {
              yield "original text";
            })(),
          },
          { auth, webSocket: socket },
        ),
      ),
    ).toStrictEqual([
      {
        correlation: "chunk",
        audio: Uint8Array.of(1, 2),
        durationMs: 250,
        timestamps: [{ kind: "character", value: "X", startTimeMs: 50, endTimeMs: 200 }],
      },
      { event: "done", traceId: "native-trace" },
    ]);
  });

  test("rejects malformed native timestamp intervals", async () => {
    for (const graph_times of [[[1, 0]], [[0, "1"]], [[0]], []]) {
      await expect(
        Array.fromAsync(
          synthesizeWithTimestamps(
            { text: "hi", language: "en" },
            {
              auth,
              fetch: async () =>
                Response.json({
                  audio: "AQI=",
                  audio_timestamps: { graph_chars: ["h"], graph_times },
                }),
            },
          ),
        ),
      ).rejects.toThrow();
    }
  });

  test("type checker rejects xAI update commands on Amazon and incomplete xAI updates", () => {
    const updates = (async function* () {
      yield { command: "update", replacements: [] } as const;
    })();
    dispatchSynthesize("amazon", {
      // @ts-expect-error Amazon accepts only strings in its input stream.
      text: updates,
      voice: "Joanna",
      model: "generative",
      output: { format: "mp3" },
    });
    const missing = (async function* () {
      yield { command: "update" } as const;
    })();
    // @ts-expect-error An update must provide its replacement map.
    dispatchSynthesize("xai", { text: missing, language: "en" });
  });

  test("pre-abort never calls an injected HTTP transport", async () => {
    const controller = new AbortController();
    const failure = new Error("cancelled before request");
    controller.abort(failure);
    let called = false;
    await expect(
      Array.fromAsync(
        synthesize(
          { text: "hello", language: "en" },
          {
            auth,
            signal: controller.signal,
            fetch: async () => {
              called = true;
              return new Response();
            },
          },
        ),
      ),
    ).rejects.toBe(failure);
    expect(called).toBe(false);
  });

  test(
    "xAI native WebSocket defaults language and synthesizes without a socket override",
    { timeout: 5000 },
    async () => {
      const server = await serve((request, socket) => {
        expect(request.headers.authorization).toBe("Bearer test-key");
        const url = new URL(request.url!, "http://localhost");
        expect(url.href).not.toContain(auth.xai.apiKey);
        expect(url.searchParams.get("language")).toBe("auto");
        accept(request, socket, (message) => {
          if (message.type === "session.update")
            send(socket, { type: "session.updated", replace: message.replace });
          if (message.type === "text.clear") send(socket, { type: "audio.clear" });
          if (message.type === "text.done") {
            send(socket, { type: "audio.delta", delta: "AQI=" });
            send(socket, { type: "audio.done" });
          }
        });
      });
      const controller = new AbortController();
      try {
        const result = await Array.fromAsync(
          synthesize(
            {
              text: (async function* () {
                yield { command: "update", replacements: [] } as const;
                yield "old";
                yield { command: "clear" } as const;
                yield "new";
              })(),
            },
            { auth, webSocketUrl: server.url, signal: controller.signal },
          ),
        );
        expect(result).toStrictEqual([Uint8Array.of(1, 2)]);
      } finally {
        controller.abort();
        server.close();
      }
    },
  );

  test(
    "xAI native WebSocket authenticates the upgrade and streams updates, clear, and multiple utterances",
    { timeout: 5000 },
    async () => {
      const messages: Record<string, unknown>[] = [];
      let connections = 0;
      let turn = 0;
      const server = await serve((request, socket) => {
        connections++;
        expect(request.headers.authorization).toBe("Bearer test-key");
        expect(request.headers["sec-websocket-protocol"]).toBeUndefined();
        const url = new URL(request.url!, "http://localhost");
        expect(url.pathname).toBe("/v1/tts");
        expect(url.href).not.toContain(auth.xai.apiKey);
        expect(url.searchParams.get("voice")).toBe("custom-voice-id");
        expect(url.searchParams.get("language")).toBe("en");
        expect(url.searchParams.get("optimize_streaming_latency")).toBe("2");
        expect(url.searchParams.get("with_timestamps")).toBe("true");
        accept(request, socket, (message) => {
          messages.push(message);
          if (message.type === "session.update")
            send(socket, { type: "session.updated", replace: message.replace });
          if (message.type === "text.clear") send(socket, { type: "audio.clear" });
          if (message.type === "text.done") {
            send(socket, {
              type: "audio.delta",
              delta: "AQI=",
              audio_duration: 0.1,
              audio_timestamps: { graph_chars: ["X"], graph_times: [[0, 0.1]] },
            });
            send(socket, { type: "audio.done", trace_id: `turn-${++turn}` });
          }
        });
      });
      const replacements = [{ pattern: "Acme", replacement: "Ack me" }];
      const controller = new AbortController();
      try {
        const result = await Array.fromAsync(
          synthesizeWithTimestamps(
            {
              language: "en",
              voice: "custom-voice-id",
              latencyOptimization: "aggressive",
              text: (async function* () {
                yield { command: "update", replacements } as const;
                yield "cancelled";
                yield { command: "clear" } as const;
                yield "first";
                yield { command: "flush" } as const;
                yield { command: "update", replacements: [] } as const;
                yield "second";
              })(),
            },
            { auth, webSocketUrl: server.url, signal: controller.signal },
          ),
        );
        expect(connections).toBe(1);
        expect(messages).toStrictEqual([
          { type: "session.update", replace: { Acme: "Ack me" } },
          { type: "text.delta", delta: "cancelled" },
          { type: "text.clear" },
          { type: "text.delta", delta: "first" },
          { type: "text.done" },
          { type: "session.update", replace: {} },
          { type: "text.delta", delta: "second" },
          { type: "text.done" },
        ]);
        expect(result.filter((value) => "event" in value)).toStrictEqual([
          { event: "updated", replacements },
          { event: "clear" },
          { event: "done", traceId: "turn-1" },
          { event: "updated", replacements: [] },
          { event: "done", traceId: "turn-2" },
        ]);
        const audio = result.filter((value) => "audio" in value);
        expect(audio).toHaveLength(2);
        expect(audio[0]).toStrictEqual({
          correlation: "chunk",
          audio: Uint8Array.of(1, 2),
          durationMs: 100,
          timestamps: [{ kind: "character", value: "X", startTimeMs: 0, endTimeMs: 100 }],
        });
      } finally {
        controller.abort();
        server.close();
      }
    },
  );

  test(
    "xAI native WebSocket propagates upgrade rejection without consuming input",
    { timeout: 5000 },
    async () => {
      const server = await serve((request, socket) => {
        expect(request.headers.authorization).toBe("Bearer test-key");
        socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      });
      let consumed = false;
      try {
        await expect(
          Array.fromAsync(
            synthesize(
              {
                language: "en",
                text: (async function* () {
                  consumed = true;
                  yield "hello";
                })(),
              },
              { auth, webSocketUrl: server.url },
            ),
          ),
        ).rejects.toThrow(/WebSocket failed to open/);
        expect(consumed).toBe(false);
      } finally {
        server.close();
      }
    },
  );

  test(
    "xAI abort closes its authenticated native socket while input is stalled",
    { timeout: 5000 },
    async () => {
      let started!: () => void;
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      let disconnected!: () => void;
      const closed = new Promise<void>((resolve) => {
        disconnected = resolve;
      });
      const server = await serve((request, socket) => {
        expect(request.headers.authorization).toBe("Bearer test-key");
        socket.on("close", disconnected);
        accept(request, socket, () => {});
      });
      const controller = new AbortController();
      let returned = false;
      const text: AsyncIterable<string> = {
        [Symbol.asyncIterator]: () => ({
          next: () => {
            started();
            return new Promise(() => {});
          },
          return: async () => {
            returned = true;
            return { done: true, value: undefined };
          },
        }),
      };
      try {
        const result = Array.fromAsync(
          synthesize(
            { language: "en", text },
            { auth, webSocketUrl: server.url, signal: controller.signal },
          ),
        );
        await reading;
        controller.abort(new Error("cancel native socket"));
        await expect(result).rejects.toThrow(/cancel native socket/);
        await closed;
        expect(returned).toBe(true);
      } finally {
        controller.abort();
        server.close();
      }
    },
  );

  test(
    "xAI malformed native frames reject and close without an invalid close-code exception",
    { timeout: 5000 },
    async () => {
      let disconnected!: () => void;
      const closed = new Promise<void>((resolve) => {
        disconnected = resolve;
      });
      const server = await serve((request, socket) => {
        socket.on("close", disconnected);
        accept(request, socket, () =>
          send(socket, { type: "session.updated", replace: { invalid: 42 } }),
        );
      });
      try {
        await expect(
          Array.fromAsync(
            synthesize(
              { language: "en", replacements: [], text: (async function* () {})() },
              {
                auth,
                webSocketUrl: server.url,
              },
            ),
          ),
        ).rejects.toThrow(/replacement map/);
        await closed;
      } finally {
        server.close();
      }
    },
  );
});
