import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";
import { decodeMessagePack, encodeMessagePack } from "../../runtime/msgpack.ts";

const auth = { fish: { apiKey: "loopback-private-key" } };
const common = { model: "s2-pro", voice: "custom", output: { format: "mp3" } } as const;

async function serve(upgrade: (request: IncomingMessage, socket: Duplex) => void) {
  const sockets = new Set<Duplex>(); const server = createServer();
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", upgrade); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/proxy?tenant=one`, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}

function accept(request: IncomingMessage, socket: Duplex, receive: (value: Record<string, unknown>) => void) {
  const key = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
  let pending: Buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const opcode = pending[0]! & 15; const lengthCode = pending[1]! & 127;
      assert.equal(pending[1]! & 128, 128); assert.notEqual(lengthCode, 127);
      if (pending.length < (lengthCode === 126 ? 4 : 2)) return;
      const length = lengthCode === 126 ? pending.readUInt16BE(2) : lengthCode;
      const maskOffset = lengthCode === 126 ? 4 : 2; const offset = maskOffset + 4;
      if (pending.length < offset + length) return;
      const payload = Buffer.from(pending.subarray(offset, offset + length));
      for (let i = 0; i < length; i++) payload[i] = payload[i]! ^ pending[maskOffset + i % 4]!;
      pending = pending.subarray(offset + length);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      assert.equal(opcode, 2); receive(decodeMessagePack(payload) as Record<string, unknown>);
    }
  });
}

function send(socket: Duplex, value: object) {
  const payload = Buffer.from(encodeMessagePack(value)); assert.ok(payload.length < 126);
  socket.write(Buffer.concat([Buffer.from([0x82, payload.length]), payload]));
}

test("Fish native Node handshake carries auth and model headers, binary framing, proxy path and query", { timeout: 5000 }, async () => {
  const messages: Record<string, unknown>[] = [];
  const server = await serve((request, socket) => {
    assert.equal(request.headers.authorization, "Bearer loopback-private-key");
    assert.equal(request.headers.model, "s2-pro"); assert.equal(request.headers["sec-websocket-protocol"], undefined);
    assert.equal(request.url, "/proxy/v1/tts/live?tenant=one");
    accept(request, socket, message => {
      messages.push(message);
      if (message.event === "text") send(socket, { event: "audio", audio: Uint8Array.of(1, 2) });
      if (message.event === "stop") send(socket, { event: "finish", reason: "stop" });
    });
  });
  try {
    const result = await Array.fromAsync(synthesize({ ...common, text: (async function* () { yield "hello"; yield { command: "flush" } as const; yield "world"; })() }, { auth, baseUrl: server.url }));
    assert.deepEqual(result, [Uint8Array.of(1, 2), Uint8Array.of(1, 2)]);
    assert.deepEqual(messages.map(value => value.event), ["start", "text", "flush", "text", "stop"]);
    assert.deepEqual(messages.slice(1), [{ event: "text", text: "hello" }, { event: "flush" }, { event: "text", text: "world" }, { event: "stop" }]);
    assert.equal((messages[0]!.request as Record<string, unknown>).text, "");
  } finally { server.close(); }
});

test("Fish native socket rejects auth before consuming any input", { timeout: 5000 }, async () => {
  let consumed = false;
  const server = await serve((request, socket) => {
    assert.equal(request.headers.authorization, "Bearer loopback-private-key");
    assert.equal(request.url, "/custom/live?tenant=two");
    socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  try {
    const url = new URL(server.url); url.protocol = "ws:"; url.pathname = "/custom/live"; url.search = "?tenant=two";
    await assert.rejects(Array.fromAsync(synthesize({ ...common, text: (async function* () { consumed = true; yield "hello"; })() }, { auth, webSocketUrl: url.href })), { name: "TypeError", message: "WebSocket failed to open" });
    assert.equal(consumed, false);
  } finally { server.close(); }
});

test("Fish native abort disconnects even if input and its return both stall", { timeout: 5000 }, async () => {
  let reading!: () => void; const started = new Promise<void>(resolve => { reading = resolve; });
  let disconnected!: () => void; const closed = new Promise<void>(resolve => { disconnected = resolve; });
  let returned = false;
  const text: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({ next: () => { reading(); return new Promise(() => {}); }, return: () => { returned = true; return new Promise(() => {}); } }) };
  const server = await serve((request, socket) => { socket.on("close", disconnected); accept(request, socket, () => {}); });
  const controller = new AbortController();
  try {
    const result = Array.fromAsync(synthesize({ ...common, text }, { auth, baseUrl: server.url, signal: controller.signal }));
    await started; controller.abort(new Error("cancel Fish"));
    await assert.rejects(result, { name: "Error", message: "cancel Fish" }); await closed; assert.equal(returned, true);
  } finally { controller.abort(); server.close(); }
});
