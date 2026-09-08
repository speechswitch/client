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
  const bytes = Buffer.from(JSON.stringify({ result: { contextId: "ctx", ...result } }));
  const header = Buffer.alloc(bytes.length < 126 ? 2 : 4); header[0] = 0x81;
  if (bytes.length < 126) header[1] = bytes.length; else { header[1] = 126; header.writeUInt16BE(bytes.length, 2); }
  socket.write(Buffer.concat([header, bytes]));
}
const common = { model: "inworld-tts-2", voice: "custom-voice", output: { format: "pcm" } } as const;
const auth = { inworld: { apiKey: "loopback-private-key" } };

test("Inworld native HTTP rejects redirects instead of replaying authenticated synthesis", { timeout: 5000 }, async () => {
  const requests: { path: string | undefined; authorization: string | undefined }[] = [];
  const server = await serve((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    response.writeHead(307, { Location: "/unexpected-replay" }); response.end();
  }, () => {});
  try {
    for (const httpMode of ["stream", "single"] as const) {
      await assert.rejects(synthesize({ ...common, text: "Hi" }, { auth, httpMode, baseUrl: server.url }).next(),
        { name: "TypeError", message: "fetch failed" });
    }
    assert.deepEqual(requests, [
      { path: "/proxy/tts/v1/voice:stream?tenant=one", authorization: "Basic loopback-private-key" },
      { path: "/proxy/tts/v1/voice?tenant=one", authorization: "Basic loopback-private-key" },
    ]);
  } finally { server.close(); }
});

for (const token of [undefined, "one.time-token"]) test(`Inworld native WebSocket ${token ? "bearer subprotocol" : "Basic header"} auth and pipelined synthesis`, { timeout: 5000 }, async () => {
  const messages: Record<string, any>[] = []; let created = false;
  const server = await serve(() => {}, (request, socket) => {
    assert.equal(request.url, "/proxy/tts/v1/voice:streamBidirectional?tenant=one");
    assert.equal(request.headers.authorization, token ? undefined : "Basic loopback-private-key");
    assert.equal(request.headers["sec-websocket-protocol"], token ? `bearer_${token}` : undefined);
    accept(request, socket, message => {
      messages.push(message);
      if (message.send_text) {
        // Deliberately withhold contextCreated until text arrives: an adapter
        // that waits for create acknowledgement would deadlock this test.
        if (!created) { created = true; send(socket, { contextCreated: {} }); }
        send(socket, { audioChunk: { audioContent: "AQI=" } });
      }
      if (message.flush_context) send(socket, { flushCompleted: {} });
      if (message.close_context) send(socket, { contextClosed: {} });
    });
  });
  let resume!: () => void; const paused = new Promise<void>(resolve => { resume = resolve; });
  const text = (async function* () { yield "Hi"; await paused; yield { command: "flush" as const }; yield "!"; })();
  try {
    const result = synthesize({ ...common, text }, { auth: token ? { inworld: { accessToken: token } } : auth, baseUrl: server.url, contextId: "ctx" });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(1, 2) });
    assert.deepEqual(messages, [
      { contextId: "ctx", create: { voiceId: "custom-voice", modelId: "inworld-tts-2", audioConfig: { audioEncoding: "PCM", sampleRateHertz: 48000, speakingRate: 1 },
        deliveryMode: "BALANCED", applyTextNormalization: "APPLY_TEXT_NORMALIZATION_UNSPECIFIED", timestampType: "TIMESTAMP_TYPE_UNSPECIFIED", timestampTransportStrategy: "ASYNC", maxBufferDelayMs: 0, bufferCharThreshold: 1000, autoMode: false } },
      { contextId: "ctx", send_text: { text: "Hi" } },
    ]);
    resume(); assert.deepEqual(await Array.fromAsync(result), [{ event: "flush", correlationId: "ctx:0", inputGroupId: "0" }, Uint8Array.of(1, 2)]);
    assert.deepEqual(messages.slice(2), [{ contextId: "ctx", flush_context: {} }, { contextId: "ctx", send_text: { text: "!" } }, { contextId: "ctx", close_context: {} }]);
  } finally { resume(); server.close(); }
});

test("Inworld native rejected handshake does not acquire input", { timeout: 5000 }, async () => {
  let acquired = false;
  const server = await serve(() => {}, (_request, socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"));
  try {
    const text = { [Symbol.asyncIterator](): AsyncIterator<string> { acquired = true; throw new Error("unexpected input"); } };
    await assert.rejects(synthesize({ ...common, text }, { auth, baseUrl: server.url }).next(), { name: "TypeError", message: "WebSocket failed to open" }); assert.equal(acquired, false);
  } finally { server.close(); }
});

test("Inworld native abort disconnects without flushing a stalled input", { timeout: 5000 }, async () => {
  let start!: () => void; const active = new Promise<void>(resolve => { start = resolve; });
  let disconnect!: () => void; const disconnected = new Promise<void>(resolve => { disconnect = resolve; }); let returned = 0;
  const messages: Record<string, unknown>[] = [];
  const server = await serve(() => {}, (request, socket) => { socket.on("close", disconnect); accept(request, socket, message => { messages.push(message); send(socket, { contextCreated: {} }); start(); }); });
  const controller = new AbortController();
  try {
    const text = { [Symbol.asyncIterator]() { return { next() { return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
    const pending = synthesize({ ...common, text }, { auth, baseUrl: server.url, signal: controller.signal, contextId: "ctx" }).next();
    await active; controller.abort(new Error("barge in")); await assert.rejects(pending, { name: "Error", message: "barge in" });
    await disconnected; assert.equal(returned, 1); assert.deepEqual(messages.map(message => Object.keys(message).sort()), [["contextId", "create"]]);
  } finally { controller.abort(); server.close(); }
});

test("Inworld native HTTP resolves environment auth and streams fragmented UTF-8 with trailing alignment", { timeout: 5000 }, async () => {
  const previous = process.env.SPEECHSWITCH_INWORLD_API_KEY; process.env.SPEECHSWITCH_INWORLD_API_KEY = "environment-key";
  let finish!: () => void;
  const server = await serve((request, response) => {
    assert.equal(request.url, "/proxy/tts/v1/voice:stream?tenant=one"); assert.equal(request.headers.authorization, "Basic environment-key");
    const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { voiceId: "custom-voice", modelId: "inworld-tts-2", audioConfig: { audioEncoding: "PCM", sampleRateHertz: 48000, speakingRate: 1 },
        deliveryMode: "BALANCED", applyTextNormalization: "APPLY_TEXT_NORMALIZATION_UNSPECIFIED", timestampType: "CHARACTER", timestampTransportStrategy: "ASYNC", text: "é", enhanceGeneration: false });
      response.writeHead(200, { "content-type": "application/json" }); response.write('{"result":{"audioContent":"AQI="}}\n');
      finish = () => {
        const bytes = Buffer.from('{"result":{"timestampInfo":{"characterAlignment":{"characters":["é"],"characterStartTimeSeconds":[0],"characterEndTimeSeconds":[0.25]}}}}');
        for (const byte of bytes) response.write(Buffer.from([byte])); response.end();
      };
    });
  }, () => {});
  try {
    const result = synthesize({ ...common, text: "é", timestampGranularity: "character" }, { baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: { correlation: "timeline", audio: Uint8Array.of(1, 2), timestamps: [] } });
    finish(); assert.deepEqual(await Array.fromAsync(result), [{ correlation: "timeline", timestamps: [{ kind: "character", value: "é", startTimeMs: 0, endTimeMs: 250 }] }]);
  } finally { if (previous === undefined) delete process.env.SPEECHSWITCH_INWORLD_API_KEY; else process.env.SPEECHSWITCH_INWORLD_API_KEY = previous; server.close(); }
});
