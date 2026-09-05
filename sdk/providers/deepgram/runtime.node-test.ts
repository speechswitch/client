import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

const auth = { deepgram: { apiKey: "loopback-private-key" } } as const;

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
    url: `ws://127.0.0.1:${address.port}/proxy/v1/speak`,
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


const common = { model: "aura-1", voice: "asteria", language: "en", output: { format: "pcm", sampleRateHz: 24000 } } as const;

test("Deepgram native Node socket authenticates with headers and completes multiple utterances", { timeout: 5000 }, async () => {
  const messages: Record<string, unknown>[] = [];
  let disconnected!: () => void;
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  let sequence = 0;
  const server = await serve((request, socket) => {
    socket.on("close", disconnected);
    assert.equal(request.headers.authorization, "Token loopback-private-key");
    assert.equal(request.headers["sec-websocket-protocol"], undefined);
    assert.equal(request.url, "/proxy/v1/speak?model=aura-asteria-en&encoding=linear16&sample_rate=24000");
    accept(request, socket, message => {
      messages.push(message);
      if (message.type === "Clear") send(socket, { type: "Cleared", sequence_id: sequence++ });
      if (message.type === "Flush") {
        socket.write(Buffer.from([0x82, 2, 1, 2]));
        send(socket, { type: "Flushed", sequence_id: sequence++ });
      }
    });
    send(socket, { type: "Metadata", request_id: "trace-1" });
  });
  try {
    const result = await Array.fromAsync(synthesize({ ...common, text: (async function* () {
      yield "cancelled"; yield { command: "clear" } as const;
      yield "first"; yield { command: "flush" } as const; yield "second";
    })() }, { auth, webSocketUrl: server.url }));
    assert.deepEqual(result, [
      { event: "clear", sequenceId: 0 },
      Uint8Array.of(1, 2), { event: "done", sequenceId: 1, traceId: "trace-1" },
      Uint8Array.of(1, 2), { event: "done", sequenceId: 2, traceId: "trace-1" },
    ]);
    await closed;
    assert.deepEqual(messages, [
      { type: "Speak", text: "cancelled" }, { type: "Clear" },
      { type: "Speak", text: "first" }, { type: "Flush" },
      { type: "Speak", text: "second" }, { type: "Flush" }, { type: "Close" },
    ]);
  } finally { server.close(); }
});

test("Deepgram native socket rejects authentication before advancing input", { timeout: 5000 }, async () => {
  let consumed = false;
  const server = await serve((request, socket) => {
    assert.equal(request.headers.authorization, "Token loopback-private-key");
    socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  try {
    await assert.rejects(Array.fromAsync(synthesize({ ...common, text: (async function* () {
      consumed = true; yield "hello";
    })() }, { auth, webSocketUrl: server.url })), { name: "TypeError", message: "WebSocket failed to open" });
    assert.equal(consumed, false);
  } finally { server.close(); }
});

test("Deepgram native socket closes on abort while the input iterator is stalled", { timeout: 5000 }, async () => {
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  let disconnected!: () => void;
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = await serve((request, socket) => {
    socket.on("close", disconnected);
    accept(request, socket, () => {});
  });
  let returned = false;
  const controller = new AbortController();
  const text: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({
    next: () => { reading(); return new Promise(() => {}); },
    return: async () => { returned = true; return { done: true, value: undefined }; },
  }) };
  try {
    const result = Array.fromAsync(synthesize({ ...common, text }, { auth, webSocketUrl: server.url, signal: controller.signal }));
    await started;
    controller.abort(new Error("cancel socket"));
    await assert.rejects(result, { name: "Error", message: "cancel socket" });
    await closed;
    assert.equal(returned, true);
  } finally { controller.abort(); server.close(); }
});
