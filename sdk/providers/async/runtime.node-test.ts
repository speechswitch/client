import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

const request = { voice: "custom", model: "flash_v1.5", output: { format: "pcm", sampleRateHz: 24000 } } as const;
const auth = { async: { apiKey: "loopback-test-key" } } as const;

test("Node native fetch streams bytes before the server finishes", { timeout: 5000 }, async () => {
  let finish!: () => void;
  const server = createServer((incoming, response) => {
    assert.equal(incoming.url, "/text_to_speech/streaming");
    assert.equal(incoming.headers["x-api-key"], "loopback-test-key");
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write(Buffer.from([1, 2]));
    finish = () => response.end(Buffer.from([3]));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const stream = synthesize({ ...request, text: "hello" }, { auth, baseUrl: `http://127.0.0.1:${address.port}` });
  try {
    assert.deepEqual((await stream.next()).value, Uint8Array.of(1, 2));
    finish();
    assert.deepEqual((await stream.next()).value, Uint8Array.of(3));
    assert.equal((await stream.next()).done, true);
  } finally {
    await stream.return?.();
    server.closeAllConnections();
    server.close();
  }
});

test("Node native WebSocket uses the documented query handshake and context protocol", { timeout: 5000 }, async () => {
  const messages: Record<string, unknown>[] = [];
  const sockets = new Set<Duplex>();
  const server = createServer();
  server.on("upgrade", (incoming, socket) => {
    sockets.add(socket);
    const url = new URL(incoming.url!, "http://localhost");
    assert.equal(url.pathname, "/text_to_speech/websocket/ws");
    assert.equal(url.searchParams.get("api_key"), "loopback-test-key");
    assert.equal(url.searchParams.get("version"), "v1");
    const accept = createHash("sha1").update(incoming.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const opcode = pending[0]! & 15;
        const lengthCode = pending[1]! & 127;
        assert.notEqual(lengthCode, 127, "test frames fit in 16-bit lengths");
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
        messages.push(message);
        if (message.close_context) {
          const audio = Buffer.from(JSON.stringify({ context_id: message.context_id, audio: "AQID", final: true }));
          assert.ok(audio.length < 126);
          socket.write(Buffer.concat([Buffer.from([0x81, audio.length]), audio]));
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    async function* text() { yield "hello"; yield "world"; }
    const chunks = await Array.fromAsync(synthesize({ ...request, text: text() }, {
      auth, webSocketUrl: `ws://127.0.0.1:${address.port}/text_to_speech/websocket/ws`,
    }));
    assert.deepEqual(chunks, [Uint8Array.of(1, 2, 3)]);
    assert.equal(messages[0]!.model_id, "async_flash_v1.5");
    assert.deepEqual(messages.slice(1).map(message => message.transcript), ["hello ", "world ", ""]);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});
