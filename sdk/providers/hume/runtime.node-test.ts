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
  return { url: `http://127.0.0.1:${address.port}/proxy?tenant=one`, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}
function frame(socket: Duplex, opcode: number, bytes: Uint8Array) {
  const header = Buffer.alloc(bytes.length < 126 ? 2 : 4); header[0] = 0x80 | opcode;
  header[1] = bytes.length < 126 ? bytes.length : 126; if (bytes.length >= 126) header.writeUInt16BE(bytes.length, 2);
  socket.write(Buffer.concat([header, bytes]));
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
      if (opcode === 8) { socket.end(); return; }
      assert.equal(opcode, 1); receive(JSON.parse(payload.toString()));
    }
  });
}
const common = { model: "octave-2", voice: "custom", output: { format: "pcm" } } as const;

test("Hume native HTTP rejects redirects without replaying authenticated synthesis", { timeout: 5000 }, async () => {
  const requests: { path: string | undefined; apiKey: string | string[] | undefined }[] = [];
  const server = await serve((request, response) => {
    requests.push({ path: request.url, apiKey: request.headers["x-hume-api-key"] });
    response.writeHead(307, { Location: "/unexpected-replay" }); response.end();
  });
  try {
    for (const includeMetadata of [false, true]) {
      await assert.rejects(synthesize({ ...common, text: "Hello" }, { auth: { hume: { apiKey: "test-key" } }, includeMetadata, baseUrl: server.url }).next(),
        { name: "TypeError", message: "fetch failed" });
    }
    assert.deepEqual(requests, [
      { path: "/proxy/v0/tts/stream/file?tenant=one", apiKey: "test-key" },
      { path: "/proxy/v0/tts/stream/json?tenant=one", apiKey: "test-key" },
    ]);
  } finally { server.close(); }
});

for (const token of [undefined, "temporary+/="]) test(`Hume native socket ${token ? "token" : "API key"} auth and early byte-native audio`, { timeout: 5000 }, async () => {
  const messages: Record<string, unknown>[] = [];
  const server = await serve(() => {}, (request, socket) => {
    const url = new URL(request.url!, "https://loopback.invalid"); assert.equal(url.pathname, "/proxy/v0/tts/stream/input");
    assert.deepEqual(Object.fromEntries(url.searchParams), { tenant: "one", [token ? "access_token" : "api_key"]: token ?? "test-private-key", format_type: "pcm", version: "2", instant_mode: "true", no_binary: "false", strip_headers: "true", context_generation_id: "previous", temperature: "0.1" });
    accept(request, socket, value => {
      messages.push(value);
      if (value.text !== undefined) frame(socket, 2, Uint8Array.of(1, 2));
      if (value.close) frame(socket, 8, Uint8Array.of(3, 232));
    });
  });
  let resume!: () => void; const paused = new Promise<void>(resolve => { resume = resolve; });
  const text = (async function* () { yield "Hel"; await paused; yield "lo"; yield { command: "flush" as const }; })();
  try {
    const result = synthesize({ ...common, text, contextBefore: { requestIds: ["previous"] }, temperature: 0.1 }, { auth: { hume: token ? { accessToken: token } : { apiKey: "test-private-key" } }, baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(1, 2) });
    assert.deepEqual(messages, [{ text: "Hel", voice: { id: "custom", provider: "CUSTOM_VOICE" }, speed: 1, trailing_silence: 0 }]);
    resume(); assert.deepEqual(await Array.fromAsync(result), [Uint8Array.of(1, 2)]);
    assert.deepEqual(messages.slice(1), [{ text: "lo", voice: { id: "custom", provider: "CUSTOM_VOICE" }, speed: 1, trailing_silence: 0 }, { flush: true }, { close: true }]);
  } finally { resume(); server.close(); }
});

test("Hume native JSON socket requests both timestamp kinds and preserves independent groups", { timeout: 5000 }, async () => {
  const server = await serve(() => {}, (request, socket) => {
    const url = new URL(request.url!, "https://loopback.invalid");
    assert.equal(url.searchParams.get("no_binary"), "true"); assert.deepEqual(url.searchParams.getAll("include_timestamp_types"), ["word", "phoneme"]);
    accept(request, socket, value => {
      if (value.text) frame(socket, 1, Buffer.from(JSON.stringify({ type: "timestamp", generation_id: "gen", request_id: "req", snippet_id: "snippet", timestamp: { type: "phoneme", text: "ʃ", time: { begin: 10, end: 40 } } })));
      if (value.close) frame(socket, 8, Uint8Array.of(3, 232));
    });
  });
  try {
    const text = (async function* () { yield "Hi"; })();
    assert.deepEqual(await Array.fromAsync(synthesize({ ...common, text, timestampGranularity: ["word", "phoneme"] as const }, { auth: { hume: { apiKey: "test" } }, baseUrl: server.url })), [
      { correlation: "timeline", correlationId: "snippet", generationId: "gen", requestId: "req", timestamps: [{ kind: "phoneme", value: "ʃ", startTimeMs: 10, endTimeMs: 40 }] },
    ]);
  } finally { server.close(); }
});

test("Hume native HTTP token auth streams NDJSON across split UTF-8 before EOF", { timeout: 5000 }, async () => {
  let end!: () => void;
  const server = await serve((request, response) => {
    assert.equal(request.headers.authorization, "Bearer temporary"); assert.equal(request.headers["x-hume-api-key"], undefined);
    assert.equal(request.url, "/proxy/v0/tts/stream/json?tenant=one");
    const bytes = Buffer.from(JSON.stringify({ type: "timestamp", generation_id: "gen", request_id: "req", snippet_id: "snippet", timestamp: { type: "phoneme", text: "ʃ", time: { begin: 10, end: 40 } } }) + "\n");
    const split = bytes.indexOf(Buffer.from("ʃ")) + 1;
    response.writeHead(200, { "content-type": "application/x-ndjson" }); response.write(bytes.subarray(0, split));
    setImmediate(() => response.write(bytes.subarray(split))); end = () => response.end();
  });
  try {
    const result = synthesize({ ...common, text: "Hi", timestampGranularity: "phoneme" }, { auth: { hume: { accessToken: "temporary" } }, baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: { correlation: "timeline", correlationId: "snippet", generationId: "gen", requestId: "req", timestamps: [{ kind: "phoneme", value: "ʃ", startTimeMs: 10, endTimeMs: 40 }] } });
    end(); assert.deepEqual(await result.next(), { done: true, value: undefined });
  } finally { server.close(); }
});

test("Hume native handshake rejects auth before acquiring the producer", { timeout: 5000 }, async () => {
  let acquired = false;
  const server = await serve(() => {}, (_, socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"));
  try {
    const text = { [Symbol.asyncIterator](): AsyncIterator<string> { acquired = true; throw new Error("unexpected input"); } };
    await assert.rejects(synthesize({ ...common, text }, { auth: { hume: { apiKey: "invalid" } }, baseUrl: server.url }).next(), { name: "TypeError", message: "WebSocket failed to open" });
    assert.equal(acquired, false);
  } finally { server.close(); }
});

test("Hume native HTTP resolves its environment key and delivers early raw bytes", { timeout: 5000 }, async () => {
  const previous = process.env.SPEECHSWITCH_HUME_API_KEY; process.env.SPEECHSWITCH_HUME_API_KEY = "loopback-environment-key";
  let end!: () => void;
  const server = await serve((request, response) => {
    assert.equal(request.headers["x-hume-api-key"], "loopback-environment-key"); assert.equal(request.headers.authorization, undefined);
    assert.equal(request.url, "/proxy/v0/tts/stream/file?tenant=one");
    response.writeHead(200, { "content-type": "audio/mpeg" }); response.write(Uint8Array.of(1)); end = () => response.end(Uint8Array.of(2));
  });
  try {
    const result = synthesize({ ...common, text: "Hi", output: { format: "mp3" } }, { baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(1) }); end();
    assert.deepEqual(await Array.fromAsync(result), [Uint8Array.of(2)]);
  } finally {
    if (previous === undefined) delete process.env.SPEECHSWITCH_HUME_API_KEY; else process.env.SPEECHSWITCH_HUME_API_KEY = previous;
    server.close();
  }
});

test("Hume native abort disconnects without waiting for a stalled producer", { timeout: 5000 }, async () => {
  let active!: () => void; const acquired = new Promise<void>(resolve => { active = resolve; }); let returned = 0;
  let disconnect!: () => void; const disconnected = new Promise<void>(resolve => { disconnect = resolve; });
  const server = await serve(() => {}, (request, socket) => { accept(request, socket, () => {}); socket.on("close", disconnect); });
  const controller = new AbortController();
  try {
    const text = { [Symbol.asyncIterator]() { return { next() { active(); return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
    const result = synthesize({ ...common, text }, { auth: { hume: { apiKey: "test" } }, baseUrl: server.url, signal: controller.signal }).next();
    await acquired; const reason = new Error("Stop"); controller.abort(reason); await assert.rejects(result, reason); await disconnected; assert.equal(returned, 1);
  } finally { server.close(); }
});
