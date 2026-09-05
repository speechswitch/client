import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { synthesize } from "./index.ts";

const base = { model: "flash-v2.5", voice: "custom/id", output: { format: "mp3" } } as const;
const auth = { elevenlabs: { apiKey: "loopback-key" } } as const;

test("ElevenLabs native Node HTTP streams before completion and aborts a stalled response", { timeout: 5000 }, async () => {
  let disconnected!: () => void;
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/proxy/v1/text-to-speech/custom%2Fid/stream?output_format=mp3_44100_128&enable_logging=true");
    assert.equal(request.headers["xi-api-key"], "loopback-key");
    const parts: Buffer[] = []; for await (const part of request) parts.push(part);
    assert.equal(JSON.parse(Buffer.concat(parts).toString()).model_id, "eleven_flash_v2_5");
    response.on("close", disconnected); response.writeHead(200, { "content-type": "audio/mpeg" }); response.write(Buffer.from([1, 2]));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const stream = synthesize({ ...base, text: "hello" }, { auth, baseUrl: `http://127.0.0.1:${address.port}/proxy`, signal: controller.signal });
  try {
    assert.deepEqual((await stream.next()).value, Uint8Array.of(1, 2));
    const pending = stream.next(); controller.abort(new Error("cancel HTTP")); await assert.rejects(pending, /cancel HTTP/); await closed;
  } finally { controller.abort(); await stream.return?.(); server.closeAllConnections(); server.close(); }
});

test("ElevenLabs native Node NDJSON preserves split UTF-8, chunk alignment, and the last record", { timeout: 5000 }, async () => {
  let finish!: () => void;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    const first = Buffer.from(JSON.stringify({ audio_base64: "AQ==", alignment: { characters: ["é"], character_start_times_seconds: [0], character_end_times_seconds: [0.05] } }) + "\n");
    const split = first.indexOf(Buffer.from("é")) + 1;
    response.write(first.subarray(0, split)); response.write(first.subarray(split));
    finish = () => response.end(JSON.stringify({ audio_base64: "Ag==" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const stream = synthesize({ ...base, text: "é", timestampGranularity: "character" }, { auth, baseUrl: `http://127.0.0.1:${address.port}`, signal: controller.signal });
  try {
    assert.deepEqual((await stream.next()).value, { correlation: "chunk", audio: Uint8Array.of(1), timestamps: [{ kind: "character", value: "é", startTimeMs: 0, endTimeMs: 50 }] });
    finish(); assert.deepEqual((await stream.next()).value, { correlation: "chunk", audio: Uint8Array.of(2), timestamps: [] }); assert.equal((await stream.next()).done, true);
  } finally { controller.abort(); await stream.return?.(); server.closeAllConnections(); server.close(); }
});

for (const dialogue of [false, true]) {
  for (const token of [false, true]) {
    test(`ElevenLabs native Node ${dialogue ? "dialogue" : "multi-context"} WebSocket with ${token ? "single-use token" : "API key"}`, { timeout: 5000 }, async () => {
      const sockets = new Set<Duplex>(); const sent: Record<string, any>[] = [];
      let current = ""; let old = ""; let resume!: () => void;
      const next = new Promise<void>(resolve => { resume = resolve; });
      const server = createServer();
      server.on("upgrade", (request, socket) => {
        sockets.add(socket);
        const url = new URL(request.url!, "http://localhost");
        assert.equal(url.pathname, dialogue ? "/proxy/v1/text-to-dialogue/stream-input" : "/proxy/v1/text-to-speech/custom%2Fid/multi-stream-input");
        assert.equal(url.searchParams.get("model_id"), dialogue ? "eleven_v3" : "eleven_flash_v2_5");
        assert.equal(url.searchParams.get("single_use_token"), token ? "short-lived" : null);
        assert.equal(url.searchParams.get("tenant"), "one");
        assert.equal(url.href.includes("loopback-key"), false);
        assert.equal(url.searchParams.get("sync_alignment"), "true");
        assert.equal(url.searchParams.get("seed"), "0");
        assert.equal(url.searchParams.get("apply_text_normalization"), "off");
        assert.equal(url.searchParams.get("enable_logging"), "false");
        assert.equal(url.searchParams.get("language_code"), "en");
        assert.equal(url.searchParams.get("auto_mode"), dialogue ? null : "false");
        const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        const send = (value: object) => {
          const payload = Buffer.from(JSON.stringify(dialogue ? value : { context_id: current, ...value }));
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
            const wire = JSON.parse(payload.toString()); sent.push(wire);
            if (wire.voice_settings) {
              assert.equal(wire.xi_api_key, token ? undefined : "loopback-key");
              if (dialogue) assert.deepEqual(wire.voices, ["custom/id"]); else current = wire.context_id;
            }
            if (wire.text === "old") { old = current; send({ audio: "AQ==" }); }
            if (wire.close_context) { assert.equal(wire.context_id, old); send({ context_id: old, audio: "CQ==" }); send({ context_id: old, is_final: true }); }
            if (wire.text === "new" || wire.inputs) {
              const alignment = dialogue ? { chars: ["N"], char_start_times_ms: [5], char_durations_ms: [10] } : { chars: ["N"], charStartTimesMs: [5], charDurationsMs: [10] };
              send({ audio: "Ag==", alignment });
            }
            if (wire.close_socket) send({ audio: "Aw==", is_final: true });
          }
        });
      });
      server.listen(0, "127.0.0.1"); await once(server, "listening");
      const address = server.address(); assert.ok(address && typeof address !== "string");
      async function* ttsText() { yield "old"; await next; yield { command: "clear" } as const; yield "new"; yield { command: "flush" } as const; }
      async function* dialogueText() { yield "new"; yield { command: "flush" } as const; }
      const request = dialogue ? { ...base, model: "eleven-v3" as const, text: dialogueText() } : { ...base, text: ttsText() };
      const controller = new AbortController();
      const stream = synthesize({ ...request, randomSeed: 0, language: "en", textNormalization: false, timestampGranularity: "character" }, { auth: token ? { elevenlabs: { singleUseToken: "short-lived" } } : auth, baseUrl: `http://127.0.0.1:${address.port}/proxy?tenant=one`, requestLogging: false, signal: controller.signal });
      try {
        if (!dialogue) {
          assert.deepEqual((await stream.next()).value, { correlation: "chunk", audio: Uint8Array.of(1), timestamps: [] });
          resume(); assert.deepEqual((await stream.next()).value, { event: "clear" });
        }
        assert.deepEqual((await stream.next()).value, { correlation: "chunk", audio: Uint8Array.of(2), timestamps: [{ kind: "character", value: "N", startTimeMs: 5, endTimeMs: 15 }] });
        assert.deepEqual((await stream.next()).value, { correlation: "chunk", audio: Uint8Array.of(3), timestamps: [] }); assert.equal((await stream.next()).done, true);
        assert.ok(sent.some(value => value.flush));
      } finally { resume(); controller.abort(); await stream.return?.(); for (const socket of sockets) socket.destroy(); server.closeAllConnections(); server.close(); }
    });
  }
}
