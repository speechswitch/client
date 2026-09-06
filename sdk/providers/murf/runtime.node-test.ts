import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

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
      const opcode = pending[0]! & 15; const code = pending[1]! & 127;
      assert.equal(pending[1]! & 128, 128); assert.notEqual(code, 127);
      if (pending.length < (code === 126 ? 4 : 2)) return;
      const length = code === 126 ? pending.readUInt16BE(2) : code;
      const mask = code === 126 ? 4 : 2; const offset = mask + 4;
      if (pending.length < offset + length) return;
      const payload = Buffer.from(pending.subarray(offset, offset + length));
      for (let index = 0; index < length; index++) payload[index] = payload[index]! ^ pending[mask + index % 4]!;
      pending = pending.subarray(offset + length);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      assert.equal(opcode, 1); receive(JSON.parse(payload.toString("utf8")));
    }
  });
}
test("Murf native Node WebSocket authenticates via headers and preserves the full context protocol", { timeout: 5000 }, async () => {
  const sockets = new Set<Duplex>(); const server = createServer(); const messages: Record<string, unknown>[] = [];
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", (request, socket) => {
    assert.equal(request.url, "/proxy/v1/speech/stream-input?tenant=one&model=falcon-2&format=PCM&sample_rate=24000&channel_type=MONO");
    assert.equal(request.headers.api_key, "loopback-key"); assert.equal(request.headers["sec-websocket-protocol"], undefined);
    accept(request, socket, message => {
      messages.push(message);
      if (message.text) send(socket, { context_id: message.context_id, audio: "AP+A" });
      if (message.end) send(socket, { context_id: message.context_id, final: true });
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const text = (async function* () { yield "Hello"; })();
    const actual = await Array.fromAsync(synthesize({ text, voice: "saved-custom-voice" }, { auth: { murf: { apiKey: "loopback-key" } }, baseUrl: `http://127.0.0.1:${address.port}/proxy?tenant=one` }));
    const id = messages[1]!.context_id;
    assert.deepEqual(messages, [{ min_buffer_size: 40, max_buffer_delay_in_ms: 300 }, { text: "Hello", context_id: id, voice_config: { voice_id: "saved-custom-voice", rate: 0, pitch: 0 } }, { context_id: id, text: "", end: true }]);
    assert.deepEqual(actual, [{ correlation: "ordered", correlationId: id, audio: Uint8Array.of(0, 255, 128), timestamps: [] }, { event: "done" }]);
  } finally { for (const socket of sockets) socket.destroy(); server.close(); }
});
test("Murf native HTTP yields audio early and consumer return closes the response", { timeout: 5000 }, async () => {
  let closed!: () => void; const connectionClosed = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/v1/speech/stream"); assert.equal(request.headers["api-key"], "loopback-key");
    let body = ""; for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), { text: "Hello", voiceId: "Gordon", model: "falcon-2", rate: 0, pitch: 0, format: "PCM", sampleRate: 24000, channelType: "MONO" });
    response.on("close", closed); response.writeHead(200, { "Content-Type": "audio/pcm" }); response.write(Buffer.from([0, 255, 128]));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const result = synthesize({ text: "Hello", voice: "Gordon" }, { auth: { murf: { apiKey: "loopback-key" } }, baseUrl: `http://127.0.0.1:${address.port}` });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(0, 255, 128) });
    await result.return!(undefined); await connectionClosed;
  } finally { server.closeAllConnections(); server.close(); }
});
test("Murf rejected native upgrade never acquires input", { timeout: 5000 }, async () => {
  const server = createServer(); server.on("upgrade", (_, socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"));
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  let acquired = false;
  const text = { [Symbol.asyncIterator]() { acquired = true; return (async function* () { yield "private text"; })(); } };
  try {
    await assert.rejects(Array.fromAsync(synthesize({ text, voice: "voice" }, { auth: { murf: { apiKey: "invalid" } }, baseUrl: `http://127.0.0.1:${address.port}` })), { name: "TypeError", message: "WebSocket failed to open" });
    assert.equal(acquired, false);
  } finally { server.closeAllConnections(); server.close(); }
});
