import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

async function serve(request: (request: IncomingMessage, response: ServerResponse) => void, upgrade: (request: IncomingMessage, socket: Duplex) => void = () => {}) {
  const sockets = new Set<Duplex>(); const server = createServer(request);
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", upgrade); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}`, close() { for (const socket of sockets) socket.destroy(); server.close(); } };
}
function accept(request: IncomingMessage, socket: Duplex, receive: (message: Record<string, any>) => void) {
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
      for (let index = 0; index < length; index++) payload[index] = payload[index]! ^ pending[maskOffset + index % 4]!;
      pending = pending.subarray(offset + length);
      if (opcode === 8) { if (!socket.writableEnded) socket.end(Buffer.from([0x88, 0])); return; }
      assert.equal(opcode, 1); receive(JSON.parse(payload.toString("utf8")));
    }
  });
}
function send(socket: Duplex, message: object) {
  const bytes = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(bytes.length < 126 ? 2 : 4); header[0] = 0x81;
  if (bytes.length < 126) header[1] = bytes.length; else { header[1] = 126; header.writeUInt16BE(bytes.length, 2); }
  socket.write(Buffer.concat([header, bytes]));
}
const auth = { "voice.ai": { apiKey: "loopback-key" } };

test("Voice.ai native HTTP streams before EOF using environment auth", { timeout: 5000 }, async () => {
  const previous = process.env.SPEECHSWITCH_VOICE_AI_API_KEY; process.env.SPEECHSWITCH_VOICE_AI_API_KEY = "environment-key";
  const closed = Promise.withResolvers<void>();
  const server = await serve((request, response) => {
    assert.equal(request.url, "/api/v1/tts/speech/stream"); assert.equal(request.headers.authorization, "Bearer environment-key");
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { text: "Hello", model: "voiceai-tts-v1-latest", language: "en", audio_format: "mp3", temperature: 1, top_p: 0.8 });
      response.on("close", () => closed.resolve()); response.writeHead(200, { "content-type": "audio/mpeg" }); response.write(Buffer.from([0, 255, 128]));
    });
  });
  try {
    const stream = synthesize({ text: "Hello" }, { baseUrl: server.url });
    assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(0, 255, 128) });
    await stream.return?.(); await closed.promise;
  } finally { if (previous === undefined) delete process.env.SPEECHSWITCH_VOICE_AI_API_KEY; else process.env.SPEECHSWITCH_VOICE_AI_API_KEY = previous; server.close(); }
});

test("Voice.ai native socket sends authorization in upgrade headers and preserves flush identity", { timeout: 5000 }, async () => {
  let id = ""; const sent: object[] = [];
  const server = await serve(() => {}, (request, socket) => {
    assert.equal(request.url, "/api/v1/tts/multi-stream"); assert.equal(request.headers.authorization, "Bearer loopback-key");
    assert.equal(request.headers["sec-websocket-protocol"], undefined);
    accept(request, socket, message => {
      sent.push(message);
      if (!message.flush) id = message.context_id;
      else {
        send(socket, { context_id: id, audio: "AP+A" });
        send(socket, { context_id: id, is_last: true });
        setImmediate(() => send(socket, { context_id: id, context_closed: true }));
      }
    });
  });
  try {
    const result = await Array.fromAsync(synthesize({ text: "Hello", model: "voiceai-tts-lite-v1-latest", voice: "cloned", temperature: 0, topP: 0 }, { auth, baseUrl: server.url, transport: "websocket" }));
    assert.deepEqual(sent, [
      { context_id: id, text: "Hello", model: "voiceai-tts-lite-v1-latest", language: "en", audio_format: "mp3", temperature: 0, top_p: 0, voice_id: "cloned", delivery_mode: "raw" },
      { context_id: id, text: "", flush: true, auto_close: true },
    ]);
    assert.deepEqual(result, [{ correlation: "ordered", correlationId: id, audio: Uint8Array.of(0, 255, 128), timestamps: [] }, { event: "flush", correlationId: id }, { event: "done" }]);
  } finally { server.close(); }
});

test("Voice.ai rejected native handshake never acquires streaming text", { timeout: 5000 }, async () => {
  let acquired = false;
  const server = await serve(() => {}, (_request, socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"));
  const input: AsyncIterable<string> = { [Symbol.asyncIterator]() { acquired = true; throw new Error("Must not acquire input"); } };
  try {
    await assert.rejects(synthesize({ text: input }, { auth, baseUrl: server.url }).next(), { name: "TypeError", message: "WebSocket failed to open" });
    assert.equal(acquired, false);
  } finally { server.close(); }
});

test("Voice.ai native socket abort releases a stalled producer without waiting for return", { timeout: 5000 }, async () => {
  const connected = Promise.withResolvers<void>(); const closed = Promise.withResolvers<void>(); let returned = 0;
  const controller = new AbortController();
  const server = await serve(() => {}, (request, socket) => {
    accept(request, socket, () => {}); socket.on("close", () => closed.resolve());
  });
  const input: AsyncIterable<string> = { [Symbol.asyncIterator]() { connected.resolve(); return { next: () => new Promise(() => {}), return() { returned++; return new Promise(() => {}); } }; } };
  try {
    const pending = synthesize({ text: input }, { auth, baseUrl: server.url, signal: controller.signal }).next(); await connected.promise;
    controller.abort(new Error("stop")); await assert.rejects(pending, { name: "Error", message: "stop" });
    await closed.promise; assert.equal(returned, 1);
  } finally { controller.abort(); server.close(); }
});
