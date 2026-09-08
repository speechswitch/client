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
  return { url: `http://127.0.0.1:${address.port}/proxy/api?tenant=one`, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}
function accept(request: IncomingMessage, socket: Duplex, receive: (message: Record<string, unknown>) => void) {
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
}
function send(socket: Duplex, message: object) {
  const bytes = Buffer.from(JSON.stringify(message)); assert.ok(bytes.length < 126);
  socket.write(Buffer.concat([Buffer.from([0x81, bytes.length]), bytes]));
}
const common = { voice: "custom-voice", output: { format: "pcm" } } as const;
const auth = { gradium: { apiKey: "loopback-private-key" } };

for (const token of [undefined, "single-use+/="]) test(`Gradium native WebSocket uses ${token ? "single-use token" : "header authentication"}`, { timeout: 5000 }, async () => {
  const messages: Record<string, unknown>[] = [];
  const server = await serve(() => {}, (request, socket) => {
    const url = new URL(request.url!, "https://local.invalid");
    assert.equal(url.pathname, "/proxy/api/speech/tts"); assert.equal(url.searchParams.get("tenant"), "one");
    assert.equal(url.searchParams.get("token"), token ?? null);
    assert.equal(request.headers["x-api-key"], token ? undefined : "loopback-private-key");
    assert.equal(request.headers["sec-websocket-protocol"], undefined);
    accept(request, socket, message => {
      messages.push(message);
      if (message.type === "setup") send(socket, { type: "ready", request_id: "req" });
      if (message.type === "text") send(socket, { type: "audio", audio: "AQI=" });
      if (message.type === "end_of_stream") send(socket, { type: "end_of_stream" });
    });
  });
  let resume!: () => void; const paused = new Promise<void>(resolve => { resume = resolve; });
  const text = (async function* () { yield "Bon"; yield "jour "; await paused; yield { command: "flush" as const }; yield "ami"; })();
  try {
    const result = synthesize({ ...common, text, model: "gradium-tts-beta", lexicon: "dictionary" }, { auth: token ? { gradium: { singleUseToken: token } } : auth, baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(1, 2) });
    assert.deepEqual(messages, [
      { type: "setup", model_name: "gradium-tts-beta", voice_id: "custom-voice", output_format: "pcm_48000", json_config: { temp: 0.7, cfg_coef: 2, padding_bonus: 0 }, pronunciation_id: "dictionary", close_ws_on_eos: true, retry_for_s: 0 },
      { type: "text", text: "Bonjour" },
    ]);
    resume(); assert.deepEqual(await Array.fromAsync(result), [Uint8Array.of(1, 2), Uint8Array.of(1, 2)]);
    assert.deepEqual(messages.slice(2), [{ type: "text", text: " <flush>" }, { type: "text", text: "ami" }, { type: "end_of_stream" }]);
  } finally { resume(); server.close(); }
});

test("Gradium native handshake rejects auth before acquiring input", { timeout: 5000 }, async () => {
  let acquired = false;
  const server = await serve(() => {}, (_request, socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"));
  try {
    const text = { [Symbol.asyncIterator](): AsyncIterator<string> { acquired = true; throw new Error("unexpected input"); } };
    await assert.rejects(synthesize({ ...common, text }, { auth, baseUrl: server.url }).next(), { name: "TypeError", message: "WebSocket failed to open" });
    assert.equal(acquired, false);
  } finally { server.close(); }
});

test("Gradium native abort disconnects with stalled next and return", { timeout: 5000 }, async () => {
  let acquired!: () => void; const active = new Promise<void>(resolve => { acquired = resolve; });
  let disconnect!: () => void; const disconnected = new Promise<void>(resolve => { disconnect = resolve; }); let returned = 0;
  const server = await serve(() => {}, (request, socket) => { socket.on("close", disconnect); accept(request, socket, message => { if (message.type === "setup") send(socket, { type: "ready", request_id: "req" }); }); });
  const controller = new AbortController();
  try {
    const text = { [Symbol.asyncIterator]() { return { next() { acquired(); return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
    const pending = synthesize({ ...common, text }, { auth, baseUrl: server.url, signal: controller.signal }).next();
    await active; controller.abort(new Error("barge in"));
    await assert.rejects(pending, { name: "Error", message: "barge in" });
    await disconnected; assert.equal(returned, 1);
  } finally { controller.abort(); server.close(); }
});

test("Gradium native HTTP streams bytes before completion and uses environment auth", { timeout: 5000 }, async () => {
  const previous = process.env.SPEECHSWITCH_GRADIUM_API_KEY; process.env.SPEECHSWITCH_GRADIUM_API_KEY = "environment-key";
  let finish!: () => void;
  const server = await serve((request, response) => {
    assert.equal(request.url, "/proxy/api/post/speech/tts?tenant=one"); assert.equal(request.headers["x-api-key"], "environment-key");
    const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { model_name: "default", voice_id: "custom-voice", output_format: "pcm_48000", json_config: '{"temp":0.7,"cfg_coef":2,"padding_bonus":0}', text: "Hello", only_audio: true });
      response.writeHead(200, { "content-type": "audio/pcm" }); response.write(Buffer.from([1, 2])); finish = () => response.end(Buffer.from([3, 4]));
    });
  }, () => {});
  try {
    const result = synthesize({ ...common, text: "Hello" }, { baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(1, 2) });
    finish(); assert.deepEqual(await Array.fromAsync(result), [Uint8Array.of(3, 4)]);
  } finally { if (previous === undefined) delete process.env.SPEECHSWITCH_GRADIUM_API_KEY; else process.env.SPEECHSWITCH_GRADIUM_API_KEY = previous; server.close(); }
});

test("Gradium native HTTP timestamps preserve split UTF-8 and EOF without a terminal message", { timeout: 5000 }, async () => {
  const server = await serve((request, response) => {
    request.resume(); request.on("end", () => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      const bytes = Buffer.from('{"type":"text","text":"café","start_s":0.1,"stop_s":0.3}\n{"type":"audio","audio":"AQI=","start_s":0,"stop_s":0.08}');
      for (const byte of bytes) response.write(Buffer.from([byte])); response.end();
    });
  }, () => {});
  try {
    assert.deepEqual(await Array.fromAsync(synthesize({ ...common, text: "café", timestampGranularity: "segment" }, { auth, baseUrl: server.url })), [
      { correlation: "timeline", timestamps: [{ kind: "segment", value: "café", startTimeMs: 100, endTimeMs: 300 }] },
      { correlation: "timeline", audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 0, endTimeMs: 80 }, timestamps: [] },
    ]);
  } finally { server.close(); }
});
