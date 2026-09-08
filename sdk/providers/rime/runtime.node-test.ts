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
const auth = { rime: { apiKey: "loopback-key" } };

for (const [settings, native, segment] of [
  [{ model: "coda", language: "en", segmentation: "manual" }, "coda", "never"],
  [{ model: "mist-v3", language: "en", segmentation: "immediate" }, "mistv3", "immediate"],
  [{ model: "mist-v2", language: "es", segmentation: "sentence" }, "mistv2", "bySentence"],
] as const) test(`Rime ${settings.model} native socket uses Bearer auth, explicit query settings and clean EOS`, { timeout: 5000 }, async () => {
  const { model, language } = settings;
  const messages: Record<string, any>[] = [];
  const server = await serve(() => {}, (request, socket) => {
    const url = new URL(request.url!, "http://localhost");
    assert.equal(url.pathname, "/ws3");
    assert.equal(request.headers.authorization, "Bearer loopback-key");
    assert.equal(request.headers["sec-websocket-protocol"], undefined);
    assert.deepEqual(Object.fromEntries(url.searchParams), { tenant: "one", speaker: "custom", modelId: native, lang: model === "mist-v2" ? "spa" : language,
      samplingRate: "8000", ...(model === "mist-v2" ? { speedAlpha: "0.5", noTextNormalization: "false" } : { timeScaleFactor: "0.5" }),
      ...(model === "coda" ? {} : { pauseBetweenBrackets: "false", phonemizeBetweenBrackets: "false" }), audioFormat: "pcm", segment });
    accept(request, socket, message => {
      messages.push(message);
      if (message.text) {
        send(socket, { type: "timestamps", contextId: message.contextId, word_timestamps: { words: ["Hello"], start: [0], end: [0.25] } });
        send(socket, { type: "chunk", contextId: message.contextId, data: "AP+A" });
        send(socket, { type: "done", contextId: message.contextId });
      }
      if (message.operation === "eos") socket.end(Buffer.from([0x88, 2, 3, 232]));
    });
  });
  try {
    const result = await Array.fromAsync(synthesize({ ...settings, text: "Hello", voice: "custom", speed: 2,
      timestampGranularity: "word", output: { format: "pcm", sampleRateHz: 8000 } }, { auth, webSocketUrl: server.url.replace("http:", "ws:") + "/ws3?tenant=one" }));
    const id = messages[0]!.contextId;
    assert.deepEqual(messages, [{ text: "Hello", contextId: id }, { operation: "eos" }]);
    assert.deepEqual(result, [
      { correlation: "ordered", timestampOrigin: "synthesis", inputGroupId: id, timestamps: [{ kind: "word", value: "Hello", startTimeMs: 0, endTimeMs: 250 }] },
      { correlation: "ordered", timestampOrigin: "synthesis", inputGroupId: id, audio: Uint8Array.of(0, 255, 128), timestamps: [] },
      { event: "batch", inputGroupId: id }, { event: "done" },
    ]);
  } finally { server.close(); }
});

test("Rime rejected native handshake never acquires incremental input", { timeout: 5000 }, async () => {
  let acquired = false;
  const server = await serve(() => {}, (_request, socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"));
  const text = { [Symbol.asyncIterator](): AsyncIterator<string> { acquired = true; throw new Error("unexpected acquisition"); } };
  try {
    await assert.rejects(synthesize({ model: "coda", voice: "custom", text }, { auth, webSocketUrl: server.url.replace("http:", "ws:") }).next(), { name: "TypeError", message: "WebSocket failed to open" });
    assert.equal(acquired, false);
  } finally { server.close(); }
});

test("Rime abort disconnects native socket and closes blocked input", { timeout: 5000 }, async () => {
  const started = Promise.withResolvers<void>(); const disconnected = Promise.withResolvers<void>(); let returned = 0;
  const server = await serve(() => {}, (request, socket) => { socket.on("close", () => disconnected.resolve()); accept(request, socket, () => {}); });
  const controller = new AbortController();
  const text = { [Symbol.asyncIterator]() { return { next() { started.resolve(); return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  try {
    const pending = synthesize({ model: "coda", voice: "custom", text }, { auth, webSocketUrl: server.url.replace("http:", "ws:"), signal: controller.signal }).next();
    await started.promise; controller.abort(new Error("stop"));
    await assert.rejects(pending, { name: "Error", message: "stop" }); await disconnected.promise; assert.equal(returned, 1);
  } finally { controller.abort(); server.close(); }
});

test("Rime native HTTP uses environment auth and delivers bytes before response completion", { timeout: 5000 }, async () => {
  const previous = process.env.SPEECHSWITCH_RIME_API_KEY; process.env.SPEECHSWITCH_RIME_API_KEY = "environment-key";
  const disconnected = Promise.withResolvers<void>();
  const server = await serve((request, response) => {
    assert.equal(request.url, "/proxy/v1/rime-tts?tenant=one"); assert.equal(request.headers.authorization, "Bearer environment-key");
    assert.equal(request.headers.accept, "audio/L16");
    const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { speaker: "custom", modelId: "coda", lang: "en", samplingRate: 24000, timeScaleFactor: 1, text: "Hello" });
      response.on("close", () => disconnected.resolve());
      response.writeHead(200, { "content-type": "audio/L16" }); response.write(Buffer.from([0, 255, 128]));
    });
  }, () => {});
  try {
    const stream = synthesize({ model: "coda", voice: "custom", text: "Hello" }, { baseUrl: server.url + "/proxy?tenant=one" });
    assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(0, 255, 128) });
    await stream.return?.(); await disconnected.promise;
  } finally { if (previous === undefined) delete process.env.SPEECHSWITCH_RIME_API_KEY; else process.env.SPEECHSWITCH_RIME_API_KEY = previous; server.close(); }
});
