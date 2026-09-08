import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

const request = { voice: "147320", model: "mars8.1-flash-beta", language: "en-us", output: { format: "mp3" } } as const;
const auth = { camb: { apiKey: "loopback-test-key" } } as const;

test("CAMB streams native Node HTTP bytes and retains the server base path", { timeout: 5000 }, async () => {
  let finish!: () => void;
  const server = createServer((incoming, response) => {
    assert.equal(incoming.url, "/apis/tts-stream");
    assert.equal(incoming.headers["x-api-key"], "loopback-test-key");
    response.writeHead(200, { "content-type": "audio/mpeg" });
    response.write(Buffer.from([1, 2]));
    finish = () => response.end(Buffer.from([3]));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const stream = synthesize({ ...request, text: "hello" }, { auth, baseUrl: `http://127.0.0.1:${address.port}/apis` });
  try {
    assert.deepEqual((await stream.next()).value, Uint8Array.of(1, 2));
    finish();
    assert.deepEqual((await stream.next()).value, Uint8Array.of(3));
    assert.equal((await stream.next()).done, true);
  } finally {
    await stream.return?.(); server.closeAllConnections(); server.close();
  }
});

test("CAMB native Node WebSocket streams binary frames before segment.done", { timeout: 5000 }, async () => {
  const sockets = new Set<Duplex>();
  const server = createServer();
  let finish!: () => void;
  let inputEnded = false;
  server.on("upgrade", (incoming, socket) => {
    sockets.add(socket);
    const url = new URL(incoming.url!, "http://localhost");
    assert.equal(url.pathname, "/apis/live-tts/ws");
    assert.equal(url.searchParams.get("api_key"), "loopback-test-key");
    const accept = createHash("sha1").update(incoming.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (value: unknown) => {
      const payload = Buffer.from(JSON.stringify(value));
      const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
      socket.write(Buffer.concat([header, payload]));
    };
    finish = () => { send({ type: "segment.done", segment_id: 1 }); send({ type: "session.done" }); };
    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const opcode = pending[0]! & 15;
        const lengthCode = pending[1]! & 127;
        assert.notEqual(lengthCode, 127);
        if (pending.length < (lengthCode === 126 ? 4 : 2)) return;
        const length = lengthCode === 126 ? pending.readUInt16BE(2) : lengthCode;
        const maskOffset = lengthCode === 126 ? 4 : 2;
        const offset = maskOffset + 4;
        if (pending.length < offset + length) return;
        const payload = Buffer.from(pending.subarray(offset, offset + length));
        for (let index = 0; index < payload.length; index++) payload[index] = payload[index]! ^ pending[maskOffset + index % 4]!;
        pending = pending.subarray(offset + length);
        if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        assert.equal(opcode, 1);
        const message = JSON.parse(payload.toString());
        if (message.type === "session.start") send({ type: "session.ready", session_id: "session", run_id: 1, config: {} });
        if (message.type === "text.done") {
          inputEnded = true;
          send({ type: "segment.start", segment_id: 1, text: "hello", word_timestamps: [{ word: "hello", start: 0.1, end: 0.2 }] });
          socket.write(Buffer.from([0x82, 3, 1, 2, 3]));
        }
      }
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const stream = synthesize({ ...request, text: "hello", timestampGranularity: "word" }, {
    auth, webSocketUrl: `ws://127.0.0.1:${address.port}/apis/live-tts/ws`,
  });
  try {
    assert.deepEqual((await stream.next()).value, { correlation: "ordered", correlationId: "1", timestamps: [{ kind: "word", value: "hello", startTimeMs: 100, endTimeMs: 200 }] });
    assert.deepEqual((await stream.next()).value, { correlation: "ordered", correlationId: "1", audio: Uint8Array.of(1, 2, 3), timestamps: [] });
    assert.equal(inputEnded, true);
    finish();
    assert.equal((await stream.next()).done, true);
  } finally {
    await stream.return?.();
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});
