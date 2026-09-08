import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";
import { decodeFrame, type Frame } from "./protocol.ts";

async function serve(upgrade: (request: IncomingMessage, socket: Duplex) => void) {
  const sockets = new Set<Duplex>();
  const server = createServer((_, response) => { response.writeHead(404); response.end(); });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", upgrade); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/proxy?tenant=one`, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}
function accept(request: IncomingMessage, socket: Duplex, receive: (message: Frame) => void) {
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
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      assert.equal(opcode, 1); receive(decodeFrame(payload.toString("utf8")));
    }
  });
}
function send(socket: Duplex, data: string | Buffer) {
  const body = typeof data === "string" ? Buffer.from(data) : data;
  const header = Buffer.alloc(body.length < 126 ? 2 : 4); header[0] = typeof data === "string" ? 0x81 : 0x82;
  if (body.length < 126) header[1] = body.length; else { header[1] = 126; header.writeUInt16BE(body.length, 2); }
  socket.write(Buffer.concat([header, body]));
}
function finish(socket: Duplex, id: string) {
  send(socket, `Path: response\r\nX-RequestId: ${id}\r\n\r\n{"audio":{"streamId":"native-stream"}}`);
  const headers = Buffer.from(`Path: audio\r\nX-RequestId: ${id}\r\nX-StreamId: native-stream\r\n`);
  const length = Buffer.alloc(2); length.writeUInt16BE(headers.length);
  send(socket, Buffer.concat([length, headers, Buffer.from([0, 255, 128])]));
  send(socket, `Path: turn.end\r\nX-RequestId: ${id}\r\n\r\n`);
}

for (const credential of ["key", "token"] as const) {
  test(`Microsoft native Node v2 socket authenticates with ${credential} headers and preserves binary bytes`, { timeout: 5000 }, async () => {
    const messages: Frame[] = [];
    const server = await serve((request, socket) => {
      assert.equal(request.url, "/proxy/cognitiveservices/websocket/v2?tenant=one&deploymentId=existing%2Fdeployment");
      assert.equal(request.headers["ocp-apim-subscription-key"], credential === "key" ? "loopback-key" : undefined);
      assert.equal(request.headers.authorization, credential === "token" ? "Bearer short-token" : undefined);
      assert.equal(request.headers["sec-websocket-protocol"], undefined);
      assert.match(String(request.headers["x-connectionid"]), /^[a-f0-9]{32}$/);
      accept(request, socket, message => { messages.push(message); if (message.path === "text.end") finish(socket, message.requestId); });
    });
    try {
      const text = (async function* () { yield "Hello "; yield "world"; })();
      const auth = { microsoft: credential === "key" ? { apiKey: "loopback-key" } : { accessToken: "short-token" } };
      const actual = await Array.fromAsync(synthesize({ voice: "existing-custom-voice", text }, { auth, baseUrl: server.url, deploymentId: "existing/deployment" }));
      const id = messages[0]!.requestId;
      assert.deepEqual(actual, [Uint8Array.of(0, 255, 128), { event: "done", requestId: id }]);
      assert.deepEqual(messages.map(message => message.path), ["speech.config", "synthesis.context", "text.piece", "text.piece", "text.end"]);
      assert.deepEqual(messages.slice(2).map(message => message.body), ["Hello ", "world", ""]);
    } finally { server.close(); }
  });
}
test("Microsoft native whole-text timestamp requests select the SDK's v1 endpoint", { timeout: 5000 }, async () => {
  const server = await serve((request, socket) => {
    assert.equal(request.url, "/proxy/tts/cognitiveservices/websocket/v1?tenant=one");
    accept(request, socket, message => { if (message.path === "ssml") finish(socket, message.requestId); });
  });
  try {
    const actual = await Array.fromAsync(synthesize({ voice: "en-US-AvaNeural", text: "Hello", timestampGranularity: "word" }, { auth: { microsoft: { apiKey: "key" } }, baseUrl: server.url }));
    assert.equal(actual.length, 2);
    const done = actual[1]; assert.ok(done && "event" in done);
    assert.deepEqual(actual, [{ correlation: "timeline", correlationId: done.requestId, streamId: "native-stream", audio: Uint8Array.of(0, 255, 128), timestamps: [] }, { event: "done", requestId: done.requestId }]);
  } finally { server.close(); }
});
test("Microsoft failed native authentication never acquires the text producer", { timeout: 5000 }, async () => {
  let acquired = false;
  const server = await serve((_, socket) => { socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"); });
  const text = { [Symbol.asyncIterator]() { acquired = true; return (async function* () { yield "private text"; })(); } };
  try {
    const failure = await Array.fromAsync(synthesize({ voice: "voice", text }, { auth: { microsoft: { apiKey: "invalid" } }, baseUrl: server.url })).catch(error => error);
    assert.equal(failure.constructor, TypeError); assert.equal(failure.message, "WebSocket failed to open"); assert.equal(acquired, false);
  } finally { server.close(); }
});
