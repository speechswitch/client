import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { Socket } from "node:net";
import { synthesize } from "./index.ts";

async function serve(receive: (request: IncomingMessage, response: ServerResponse, body: unknown) => void) {
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => receive(request, response, JSON.parse(Buffer.concat(chunks).toString("utf8"))));
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}`, close() { for (const socket of sockets) socket.destroy(); server.close(); } };
}
const request = { model: "ssfm-v30", voice: "uc_voice", text: "Hello" } as const;
const auth = { typecast: { apiKey: "loopback-key" } };

test("Typecast native streaming sends API-key headers and yields bytes before response completion", { timeout: 5000 }, async () => {
  const previous = process.env.SPEECHSWITCH_TYPECAST_API_KEY; process.env.SPEECHSWITCH_TYPECAST_API_KEY = "environment-key";
  const disconnected = Promise.withResolvers<void>();
  const server = await serve((request, response, body) => {
    assert.equal(request.url, "/proxy/v1/text-to-speech/stream?tenant=one"); assert.equal(request.headers["x-api-key"], "environment-key");
    assert.equal(request.headers.accept, "audio/wav"); assert.equal(request.headers["x-typecast-generated-by"], undefined);
    assert.deepEqual(body, { model: "ssfm-v30", voice_id: "uc_voice", text: "Hello", prompt: { emotion_type: "preset", emotion_preset: "normal", emotion_intensity: 1 }, output: { audio_format: "wav", audio_pitch: 0, audio_tempo: 1 } });
    response.on("close", () => disconnected.resolve()); response.writeHead(200, { "content-type": "audio/wav" }); response.write(Buffer.from([82, 73, 70, 70]));
  });
  try {
    const stream = synthesize(request, { baseUrl: server.url + "/proxy?tenant=one" });
    assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(82, 73, 70, 70) });
    await stream.return?.(); await disconnected.promise;
  } finally { if (previous === undefined) delete process.env.SPEECHSWITCH_TYPECAST_API_KEY; else process.env.SPEECHSWITCH_TYPECAST_API_KEY = previous; server.close(); }
});

test("Typecast native timestamp response retains Unicode alignment and audio association", { timeout: 5000 }, async () => {
  const server = await serve((request, response) => {
    assert.equal(request.url, "/v1/text-to-speech/with-timestamps?granularity=char"); assert.equal(request.headers["x-api-key"], "loopback-key");
    assert.equal(request.headers.accept, "application/json");
    const bytes = Buffer.from(JSON.stringify({ audio: "AP+A", audio_format: "wav", audio_duration: 0.5, words: null, characters: [{ text: "😀", start: 0, end: 0.5 }] }));
    const split = bytes.indexOf(Buffer.from("😀")) + 1;
    response.writeHead(200, { "content-type": "application/json" }); response.write(bytes.subarray(0, split)); setImmediate(() => response.end(bytes.subarray(split)));
  });
  try {
    assert.deepEqual(await Array.fromAsync(synthesize({ ...request, timestampGranularity: "character" }, { auth, baseUrl: server.url })), [
      { correlation: "chunk", audio: Uint8Array.of(0, 255, 128), durationMs: 500, timestamps: [{ kind: "character", value: "😀", startTimeMs: 0, endTimeMs: 500 }] }, { event: "done" },
    ]);
  } finally { server.close(); }
});

test("Typecast native compose is one atomic request, not per-segment calls", { timeout: 5000 }, async () => {
  let calls = 0;
  const server = await serve((request, response, body) => {
    calls++; assert.equal(request.url, "/v1/text-to-speech/compose");
    assert.deepEqual(body, { segments: [
      { type: "tts", model: "ssfm-v21", voice_id: "tc_voice", text: "One", prompt: { emotion_preset: "sad", emotion_intensity: 1 }, output: { audio_format: "wav", audio_pitch: 0, audio_tempo: 1 } },
      { type: "pause", duration_seconds: 0.5 },
      { type: "tts", model: "ssfm-v30", voice_id: "uc_voice", text: "Two", prompt: { emotion_type: "preset", emotion_preset: "whisper", emotion_intensity: 1 }, output: { audio_format: "wav", audio_pitch: 0, audio_tempo: 1 } },
    ] });
    response.writeHead(200, { "content-type": "audio/wav" }); response.end(Buffer.from([1, 2]));
  });
  try {
    const result = await Array.fromAsync(synthesize({ segments: [
      { kind: "speech", model: "ssfm-v21", voice: "tc_voice", text: "One", emotion: "sad" }, { kind: "pause", pauseMs: 500 },
      { kind: "speech", model: "ssfm-v30", voice: "uc_voice", text: "Two", emotion: "whisper" },
    ] }, { auth, baseUrl: server.url }));
    assert.deepEqual(result, [Uint8Array.of(1, 2), { event: "done" }]); assert.equal(calls, 1);
  } finally { server.close(); }
});

test("Typecast cancellation interrupts a native pending read and disconnects", { timeout: 5000 }, async () => {
  const disconnected = Promise.withResolvers<void>(); const controller = new AbortController();
  const server = await serve((_request, response) => {
    response.on("close", () => disconnected.resolve()); response.writeHead(200, { "content-type": "audio/wav" }); response.write(Buffer.from([1]));
  });
  try {
    const stream = synthesize(request, { auth, baseUrl: server.url, signal: controller.signal });
    assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(1) });
    const pending = stream.next(); controller.abort(new Error("stop"));
    await assert.rejects(pending, { name: "Error", message: "stop" }); await disconnected.promise;
  } finally { controller.abort(); server.close(); }
});
