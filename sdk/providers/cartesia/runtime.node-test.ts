import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

const request = { voice: "custom-voice", model: "sonic-3.5", output: { format: "pcm", sampleEncoding: "signed_integer_16", sampleRateHz: 24000, byteOrder: "little_endian" } } as const;
const auth = { cartesia: { apiKey: "loopback-key" } } as const;

test("Cartesia streams native Node HTTP bytes before the response finishes", { timeout: 5000 }, async () => {
  let finish!: () => void;
  const server = createServer((incoming, response) => {
    assert.equal(incoming.url, "/tts/bytes");
    assert.equal(incoming.headers.authorization, "Bearer loopback-key");
    assert.equal(incoming.headers["cartesia-version"], "2026-08-14");
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write(Buffer.from([1, 2])); finish = () => response.end(Buffer.from([3]));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const stream = synthesize({ ...request, text: "hello" }, { auth, baseUrl: `http://127.0.0.1:${address.port}`, signal: controller.signal });
  try {
    assert.deepEqual((await stream.next()).value, Uint8Array.of(1, 2)); finish();
    assert.deepEqual((await stream.next()).value, Uint8Array.of(3)); assert.equal((await stream.next()).done, true);
  } finally { controller.abort(); await stream.return?.(); server.closeAllConnections(); server.close(); }
});

test("Cartesia native Node SSE preserves independent timing and aborts a stalled body", { timeout: 5000 }, async () => {
  const server = createServer(async (incoming, response) => {
    assert.equal(incoming.url, "/tts/sse");
    const parts: Buffer[] = []; for await (const part of incoming) parts.push(part);
    const wire = JSON.parse(Buffer.concat(parts).toString());
    assert.equal(wire.add_phoneme_timestamps, true);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ type: "phoneme_timestamps", done: false, status_code: 200, context_id: wire.context_id, phoneme_timestamps: { phonemes: ["h"], start: [0], end: [0.1] } })}\r\n\r\n`);
    response.write(`data: ${JSON.stringify({ type: "chunk", done: false, status_code: 200, context_id: wire.context_id, data: "AQI=" })}\r\n\r\n`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const stream = synthesize({ ...request, text: "hello", timestampGranularity: "phoneme" }, { auth, baseUrl: `http://127.0.0.1:${address.port}`, signal: controller.signal });
  try {
    const first = (await stream.next()).value; assert.ok(first && "correlation" in first);
    assert.equal(first.correlation, "timeline"); assert.deepEqual(first.timestamps, [{ kind: "phoneme", value: "h", startTimeMs: 0, endTimeMs: 100 }]);
    const second = (await stream.next()).value; assert.ok(second && "correlation" in second);
    assert.deepEqual(second.audio, Uint8Array.of(1, 2)); assert.deepEqual(second.timestamps, []);
    const pending = stream.next(); controller.abort(new Error("cancel SSE"));
    await assert.rejects(pending, /cancel SSE/);
  } finally { controller.abort(); await stream.return?.(); server.closeAllConnections(); server.close(); }
});

for (const credential of ["apiKey", "accessToken"] as const) {
  test(`Cartesia native Node WebSocket authenticates with ${credential}, clears old audio, and keeps flush groups`, { timeout: 5000 }, async () => {
    const sockets = new Set<Duplex>(); let exchanges = 0; let oldContext = ""; let newContext = "";
    const server = createServer(async (incoming, response) => {
      assert.equal(incoming.url, "/access-token"); assert.equal(incoming.method, "POST");
      assert.equal(incoming.headers.authorization, "Bearer loopback-key");
      assert.equal(incoming.headers["cartesia-version"], "2026-08-14");
      const parts: Buffer[] = []; for await (const part of incoming) parts.push(part);
      assert.deepEqual(JSON.parse(Buffer.concat(parts).toString()), { grants: { tts: true }, expires_in: 60 });
      exchanges++; response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ token: "short-lived-token" }));
    });
    server.on("upgrade", (incoming, socket) => {
      sockets.add(socket);
      const url = new URL(incoming.url!, "http://localhost");
      assert.equal(url.pathname, "/tts/websocket"); assert.equal(url.searchParams.get("cartesia_version"), "2026-08-14");
      assert.equal(url.searchParams.get("access_token"), "short-lived-token"); assert.equal(url.searchParams.has("api_key"), false);
      assert.equal(url.href.includes("loopback-key"), false);
      const accept = createHash("sha1").update(incoming.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      const send = (context: string, value: unknown) => {
        const payload = Buffer.from(JSON.stringify({ status_code: 200, done: false, context_id: context, ...value as object }));
        const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
        socket.write(Buffer.concat([header, payload]));
      };
      let pending: Buffer = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 2) {
          const opcode = pending[0]! & 15; const lengthCode = pending[1]! & 127;
          assert.notEqual(lengthCode, 127); assert.equal(pending[1]! & 128, 128);
          if (pending.length < (lengthCode === 126 ? 4 : 2)) return;
          const length = lengthCode === 126 ? pending.readUInt16BE(2) : lengthCode;
          const maskOffset = lengthCode === 126 ? 4 : 2; const offset = maskOffset + 4;
          if (pending.length < offset + length) return;
          const payload = Buffer.from(pending.subarray(offset, offset + length));
          for (let index = 0; index < payload.length; index++) payload[index] = payload[index]! ^ pending[maskOffset + index % 4]!;
          pending = pending.subarray(offset + length);
          if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
          assert.equal(opcode, 1);
          const wire = JSON.parse(payload.toString());
          if (wire.transcript === "old") { oldContext = wire.context_id; send(oldContext, { type: "chunk", data: "AQ==", flush_id: 1 }); }
          if (wire.cancel) { assert.equal(wire.context_id, oldContext); send(oldContext, { type: "chunk", data: "CQ==", flush_id: 1 }); send(oldContext, { type: "done", done: true }); }
          if (wire.transcript === "new") { newContext = wire.context_id; assert.notEqual(newContext, oldContext); send(newContext, { type: "chunk", data: "Ag==", flush_id: 1 }); }
          if (wire.flush) send(newContext, { type: "flush_done", flush_done: true, flush_id: 1 });
          if (wire.continue === false) send(newContext, { type: "done", done: true });
        }
      });
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    let advance!: () => void;
    const afterOld = new Promise<void>(resolve => { advance = resolve; });
    async function* text() { yield "old"; await afterOld; yield { command: "clear" } as const; yield "new"; yield { command: "flush" } as const; }
    const controller = new AbortController();
    const stream = synthesize({ ...request, text: text() }, {
      auth: credential === "apiKey" ? auth : { cartesia: { accessToken: "short-lived-token" } },
      baseUrl: `http://127.0.0.1:${address.port}`, webSocketUrl: `ws://127.0.0.1:${address.port}/tts/websocket`, signal: controller.signal,
    });
    try {
      assert.deepEqual((await stream.next()).value, { correlation: "timeline", correlationId: oldContext, inputGroupId: "1", audio: Uint8Array.of(1), timestamps: [] });
      advance(); assert.deepEqual((await stream.next()).value, { event: "clear" });
      assert.deepEqual((await stream.next()).value, { correlation: "timeline", correlationId: newContext, inputGroupId: "1", audio: Uint8Array.of(2), timestamps: [] });
      assert.deepEqual((await stream.next()).value, { event: "flush", correlationId: newContext, inputGroupId: "1" });
      assert.equal((await stream.next()).done, true); assert.equal(exchanges, credential === "apiKey" ? 1 : 0);
    } finally {
      advance(); controller.abort(); await stream.return?.(); for (const socket of sockets) socket.destroy(); server.closeAllConnections(); server.close();
    }
  });
}
