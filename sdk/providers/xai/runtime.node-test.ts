import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

const auth = { xai: { apiKey: "loopback-private-key" } } as const;

async function serve(upgrade: (request: IncomingMessage, socket: Duplex) => void) {
  const sockets = new Set<Duplex>();
  const server = createServer();
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", upgrade);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `ws://127.0.0.1:${address.port}/v1/tts`,
    close: () => { for (const socket of sockets) socket.destroy(); server.close(); },
  };
}

function accept(request: IncomingMessage, socket: Duplex, receive: (message: Record<string, unknown>) => void) {
  const key = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
  let pending: Buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const opcode = pending[0]! & 15;
      const lengthCode = pending[1]! & 127;
      assert.equal(pending[1]! & 128, 128, "client frames are masked");
      assert.notEqual(lengthCode, 127, "test frames fit in 16-bit lengths");
      if (pending.length < (lengthCode === 126 ? 4 : 2)) return;
      const length = lengthCode === 126 ? pending.readUInt16BE(2) : lengthCode;
      const maskOffset = lengthCode === 126 ? 4 : 2;
      const offset = maskOffset + 4;
      if (pending.length < offset + length) return;
      const payload = Buffer.from(pending.subarray(offset, offset + length));
      for (let index = 0; index < length; index++) payload[index] = payload[index]! ^ pending[maskOffset + index % 4]!;
      pending = pending.subarray(offset + length);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      assert.equal(opcode, 1);
      receive(JSON.parse(payload.toString()));
    }
  });
}

function send(socket: Duplex, value: object) {
  const payload = Buffer.from(JSON.stringify(value));
  assert.ok(payload.length < 65536);
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  socket.write(Buffer.concat([header, payload]));
}

test("xAI native WebSocket authenticates the upgrade and streams updates, clear, and multiple utterances", { timeout: 5000 }, async () => {
  const messages: Record<string, unknown>[] = [];
  let connections = 0;
  let turn = 0;
  const server = await serve((request, socket) => {
    connections++;
    assert.equal(request.headers.authorization, "Bearer loopback-private-key");
    assert.equal(request.headers["sec-websocket-protocol"], undefined);
    const url = new URL(request.url!, "http://localhost");
    assert.equal(url.pathname, "/v1/tts");
    assert.equal(url.href.includes(auth.xai.apiKey), false);
    assert.equal(url.searchParams.get("voice"), "custom-voice-id");
    assert.equal(url.searchParams.get("language"), "en");
    assert.equal(url.searchParams.get("optimize_streaming_latency"), "2");
    assert.equal(url.searchParams.get("with_timestamps"), "true");
    accept(request, socket, message => {
      messages.push(message);
      if (message.type === "session.update") send(socket, { type: "session.updated", replace: message.replace });
      if (message.type === "text.clear") send(socket, { type: "audio.clear" });
      if (message.type === "text.done") {
        send(socket, { type: "audio.delta", delta: "AQI=", audio_duration: 0.1,
          audio_timestamps: { graph_chars: ["X"], graph_times: [[0, 0.1]] } });
        send(socket, { type: "audio.done", trace_id: `turn-${++turn}` });
      }
    });
  });
  const replacements = [{ pattern: "Acme", replacement: "Ack me" }];
  const controller = new AbortController();
  try {
    const result = await Array.fromAsync(synthesize({ language: "en", voice: "custom-voice-id",
      latencyOptimization: "aggressive", timestampGranularity: "character",
      text: (async function* () {
        yield { command: "update", replacements } as const;
        yield "cancelled";
        yield { command: "clear" } as const;
        yield "first";
        yield { command: "flush" } as const;
        yield { command: "update", replacements: [] } as const;
        yield "second";
      })(),
    }, { auth, webSocketUrl: server.url, signal: controller.signal }));
    assert.equal(connections, 1);
    assert.deepEqual(messages, [
      { type: "session.update", replace: { Acme: "Ack me" } }, { type: "text.delta", delta: "cancelled" },
      { type: "text.clear" }, { type: "text.delta", delta: "first" }, { type: "text.done" },
      { type: "session.update", replace: {} }, { type: "text.delta", delta: "second" }, { type: "text.done" },
    ]);
    assert.deepEqual(result.filter(value => "event" in value), [
      { event: "updated", replacements }, { event: "clear" }, { event: "done", traceId: "turn-1" },
      { event: "updated", replacements: [] }, { event: "done", traceId: "turn-2" },
    ]);
    const audio = result.filter(value => "audio" in value);
    assert.equal(audio.length, 2);
    assert.deepEqual(audio[0], { correlation: "chunk", audio: Uint8Array.of(1, 2), durationMs: 100,
      timestamps: [{ kind: "character", value: "X", startTimeMs: 0, endTimeMs: 100 }] });
  } finally { controller.abort(); server.close(); }
});

test("xAI native WebSocket propagates upgrade rejection without consuming input", { timeout: 5000 }, async () => {
  const server = await serve((request, socket) => {
    assert.equal(request.headers.authorization, "Bearer loopback-private-key");
    socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  let consumed = false;
  try {
    await assert.rejects(Array.fromAsync(synthesize({ language: "en", text: (async function* () {
      consumed = true; yield "hello";
    })() }, { auth, webSocketUrl: server.url })), /WebSocket failed to open/);
    assert.equal(consumed, false);
  } finally { server.close(); }
});

test("xAI abort closes its authenticated native socket while input is stalled", { timeout: 5000 }, async () => {
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let disconnected!: () => void;
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = await serve((request, socket) => {
    assert.equal(request.headers.authorization, "Bearer loopback-private-key");
    socket.on("close", disconnected);
    accept(request, socket, () => {});
  });
  const controller = new AbortController();
  let returned = false;
  const text: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({
    next: () => { started(); return new Promise(() => {}); },
    return: async () => { returned = true; return { done: true, value: undefined }; },
  }) };
  try {
    const result = Array.fromAsync(synthesize({ language: "en", text }, { auth, webSocketUrl: server.url, signal: controller.signal }));
    await reading;
    controller.abort(new Error("cancel native socket"));
    await assert.rejects(result, /cancel native socket/);
    await closed;
    assert.equal(returned, true);
  } finally { controller.abort(); server.close(); }
});

test("xAI malformed native frames reject and close without an invalid close-code exception", { timeout: 5000 }, async () => {
  let disconnected!: () => void;
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = await serve((request, socket) => {
    socket.on("close", disconnected);
    accept(request, socket, () => send(socket, { type: "session.updated", replace: { invalid: 42 } }));
  });
  try {
    await assert.rejects(Array.fromAsync(synthesize({ language: "en", replacements: [], text: (async function* () {})() }, {
      auth, webSocketUrl: server.url,
    })), /replacement map/);
    await closed;
  } finally { server.close(); }
});
