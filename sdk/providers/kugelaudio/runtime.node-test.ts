import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

async function serve(request: (request: IncomingMessage, response: ServerResponse) => void, upgrade: (request: IncomingMessage, socket: Duplex) => void) {
  const sockets = new Set<Duplex>(); const server = createServer(request);
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", upgrade); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/proxy?tenant=one`, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}
function accept(request: IncomingMessage, socket: Duplex, receive: (message: Record<string, any>) => void) {
  const key = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  const protocol = request.headers["sec-websocket-protocol"];
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n${protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : ""}\r\n`);
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
}
function send(socket: Duplex, result: object) {
  const bytes = Buffer.from(JSON.stringify(result));
  const header = Buffer.alloc(bytes.length < 126 ? 2 : 4); header[0] = 0x81;
  if (bytes.length < 126) header[1] = bytes.length; else { header[1] = 126; header.writeUInt16BE(bytes.length, 2); }
  socket.write(Buffer.concat([header, bytes]));
}

const common = { voice: "custom-voice", output: { format: "pcm" } } as const;
const auth = { kugelaudio: { apiKey: "eu-loopback-key" } };
const audio = { audio: "AQI=", enc: "pcm_s16le", sr: 24000, samples: 1, idx: 0, chunk_id: 0 };

test("KugelAudio native Node socket authenticates with headers and cancels without reconnecting", { timeout: 5000 }, async () => {
  const messages: Record<string, any>[] = [];
  const server = await serve(() => {}, (request, socket) => {
    assert.equal(request.url, "/proxy/ws/tts/stream?tenant=one");
    assert.equal(request.headers.authorization, "Bearer loopback-key");
    assert.equal(request.headers["sec-websocket-protocol"], undefined);
    accept(request, socket, message => {
      messages.push(message);
      if (message.cancel) { send(socket, audio); send(socket, { interrupted: true }); }
      if (message.text === "New") send(socket, audio);
      if (message.update_settings) send(socket, { settings_updated: true, settings: message.update_settings });
      if (message.flush) { send(socket, { final: true }); send(socket, { session_closed: true }); }
    });
  });
  try {
    const text = (async function* () { yield "Old"; yield { command: "clear" } as const; yield { command: "update", temperature: 0 } as const; yield "New"; })();
    assert.deepEqual(await Array.fromAsync(synthesize({ ...common, text }, { auth, baseUrl: server.url })), [
      { event: "clear" }, { event: "updated", temperature: 0 }, Uint8Array.of(1, 2), { event: "flush", correlationId: "1", inputGroupId: "1" },
    ]);
    // The closing control can still be in transit when the iterator returns.
    assert.deepEqual(messages.slice(0, 6), [
      { voice_id: "custom-voice", model_id: "kugel-3", cfg_scale: 2, max_new_tokens: 2048, sample_rate: 24000, normalize: true, speed: 1,
        word_timestamps: false, speaker_prefix: true, flush_timeout_ms: 500, max_buffer_length: 10000 },
      { text: "Old" }, { cancel: true }, { update_settings: { temperature: 0 } }, { text: "New" }, { flush: true },
    ]);
  } finally { server.close(); }
});

test("KugelAudio static timestamp request uses the single-request socket endpoint", { timeout: 5000 }, async () => {
  const server = await serve(() => {}, (request, socket) => {
    assert.equal(request.url, "/proxy/ws/tts?tenant=one"); assert.equal(request.headers.authorization, "Bearer loopback-key");
    accept(request, socket, message => {
      assert.deepEqual(message, { voice_id: "custom-voice", model_id: "kugel-3", cfg_scale: 2, max_new_tokens: 2048, sample_rate: 24000, normalize: true, speed: 1,
        temperature: 0.4, word_timestamps: true, speaker_prefix: true, text: "Hi" });
      send(socket, audio); send(socket, { word_timestamps: [{ word: "Hi", start_ms: 0, end_ms: 1, char_start: 0, char_end: 2 }], chunk_id: 0 }); send(socket, { final: true });
    });
  });
  try {
    assert.deepEqual(await Array.fromAsync(synthesize({ ...common, text: "Hi", timestampGranularity: "word" }, { auth, baseUrl: server.url })), [
      { correlation: "ordered", correlationId: "0:0", inputGroupId: "0", chunkId: 0, audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 0, endTimeMs: 1 / 24 }, timestamps: [] },
      { correlation: "ordered", correlationId: "0:0", inputGroupId: "0", chunkId: 0, timestamps: [{ kind: "word", value: "Hi", startTimeMs: 0, endTimeMs: 1, source: { start: 0, end: 2 } }] }, { event: "done" },
    ]);
  } finally { server.close(); }
});

test("KugelAudio rejected native handshake does not acquire input", { timeout: 5000 }, async () => {
  let acquired = false;
  const server = await serve(() => {}, (_request, socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"));
  try {
    const text = { [Symbol.asyncIterator](): AsyncIterator<string> { acquired = true; throw new Error("unexpected input"); } };
    await assert.rejects(synthesize({ ...common, text }, { auth, baseUrl: server.url }).next(), { name: "TypeError", message: "WebSocket failed to open" }); assert.equal(acquired, false);
  } finally { server.close(); }
});

test("KugelAudio abort disconnects a native socket and releases blocked input", { timeout: 5000 }, async () => {
  let start!: () => void; const started = new Promise<void>(resolve => { start = resolve; });
  let disconnect!: () => void; const disconnected = new Promise<void>(resolve => { disconnect = resolve; }); let returned = 0;
  const messages: Record<string, unknown>[] = [];
  const server = await serve(() => {}, (request, socket) => { socket.on("close", disconnect); accept(request, socket, message => { messages.push(message); start(); }); });
  const controller = new AbortController();
  try {
    const text = { [Symbol.asyncIterator]() { return { next() { return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
    const pending = synthesize({ ...common, text }, { auth, baseUrl: server.url, signal: controller.signal }).next();
    await started; controller.abort(new Error("stop")); await assert.rejects(pending, { name: "Error", message: "stop" });
    await disconnected; assert.equal(returned, 1); assert.equal(messages.length, 1); assert.equal(messages[0]!.voice_id, "custom-voice");
  } finally { controller.abort(); server.close(); }
});

test("KugelAudio native HTTP resolves environment auth and streams bytes before response end", { timeout: 5000 }, async () => {
  const previous = process.env.SPEECHSWITCH_KUGELAUDIO_API_KEY; process.env.SPEECHSWITCH_KUGELAUDIO_API_KEY = "eu-environment-key";
  let finish!: () => void;
  const server = await serve((request, response) => {
    assert.equal(request.url, "/proxy/v1/tts/generate?tenant=one"); assert.equal(request.headers.authorization, "Bearer environment-key");
    const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { voice_id: "custom-voice", model_id: "kugel-3", cfg_scale: 2, max_new_tokens: 2048, sample_rate: 8000, output_format: "ulaw_8000", normalize: true, speed: 1, temperature: 0.4, text: "Hi" });
      response.writeHead(200, { "content-type": "audio/basic", "x-sample-rate": "8000", "x-audio-format": "mulaw" }); response.write(Buffer.from([1]));
      finish = () => response.end(Buffer.from([2]));
    });
  }, () => {});
  try {
    const result = synthesize({ ...common, text: "Hi", output: { format: "mulaw" } }, { baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(1) }); finish(); assert.deepEqual(await Array.fromAsync(result), [Uint8Array.of(2)]);
  } finally { if (previous === undefined) delete process.env.SPEECHSWITCH_KUGELAUDIO_API_KEY; else process.env.SPEECHSWITCH_KUGELAUDIO_API_KEY = previous; server.close(); }
});
