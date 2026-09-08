import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

async function serve(upgrade: (request: IncomingMessage, socket: Duplex) => void) {
  const sockets = new Set<Duplex>();
  const server = createServer((_, response) => { response.writeHead(404); response.end(); });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", upgrade); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/proxy?tenant=one`, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}
function send(socket: Duplex, packet: object) {
  const body = Buffer.from(JSON.stringify(packet));
  const header = Buffer.alloc(body.length < 126 ? 2 : 4); header[0] = 0x81;
  if (body.length < 126) header[1] = body.length; else { header[1] = 126; header.writeUInt16BE(body.length, 2); }
  socket.write(Buffer.concat([header, body]));
}
function accept(request: IncomingMessage, socket: Duplex, receive: (packet: Record<string, unknown>) => void) {
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
      assert.equal(opcode, 1); receive(JSON.parse(payload.toString("utf8")));
    }
  });
  send(socket, { event: "connected_success", connect_id: "connection" });
}
test("MiniMax native Node socket uses bearer headers and the bidirectional endpoint", { timeout: 5000 }, async () => {
  const messages: Record<string, unknown>[] = []; let sessionId: unknown;
  const server = await serve((request, socket) => {
    assert.equal(request.url, "/proxy/ws/v1/t2a_v2_bidi?tenant=one");
    assert.equal(request.headers.authorization, "Bearer loopback-key");
    assert.equal(request.headers["sec-websocket-protocol"], undefined);
    accept(request, socket, message => {
      messages.push(message);
      if (message.event === "task_start") { sessionId = message.session_id; send(socket, { event: "task_started", session_id: sessionId }); }
      if (message.event === "task_continue") send(socket, { data: { audio: "00ff80" }, is_final: true, trace_id: "native-request", session_id: sessionId });
      if (message.event === "task_cancel") send(socket, { event: "task_canceled", session_id: sessionId });
      if (message.event === "task_finish") send(socket, { event: "task_finished", session_id: sessionId });
    });
  });
  try {
    const text = (async function* () { yield "Hello"; })();
    const actual = await Array.fromAsync(synthesize({ voice: "existing-clone", text }, { auth: { minimax: { apiKey: "loopback-key" } }, baseUrl: server.url }));
    assert.deepEqual(actual, [{ correlation: "ordered", correlationId: "native-request", traceId: "native-request", inputGroupId: sessionId, timestamps: [], audio: Uint8Array.of(0, 255, 128), requestComplete: true }, { event: "done" }]);
    assert.deepEqual(messages.map(message => message.event), ["task_start", "task_continue", "task_finish"]);
    assert.deepEqual(messages.slice(1), [{ event: "task_continue", text: "Hello" }, { event: "task_finish" }]);
  } finally { server.close(); }
});
test("MiniMax native authentication failure never acquires text", { timeout: 5000 }, async () => {
  let acquired = false;
  const server = await serve((_, socket) => { socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"); });
  const text = { [Symbol.asyncIterator]() { acquired = true; return (async function* () { yield "private text"; })(); } };
  try {
    const failure = await Array.fromAsync(synthesize({ voice: "voice", text }, { auth: { minimax: { apiKey: "invalid" } }, baseUrl: server.url })).catch(error => error);
    assert.equal(failure.constructor, TypeError); assert.equal(failure.message, "WebSocket failed to open"); assert.equal(acquired, false);
  } finally { server.close(); }
});
