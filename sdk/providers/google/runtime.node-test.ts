import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type ServerHttp2Stream, type IncomingHttpHeaders } from "node:http2";
import { once } from "node:events";
import { synthesize } from "./index.ts";

async function serve(handle: (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => void) {
  const server = createServer();
  const sessions = new Set<import("node:http2").ServerHttp2Session>();
  server.on("session", session => { sessions.add(session); session.on("error", () => {}); session.on("close", () => sessions.delete(session)); });
  server.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => { stream.on("error", () => {}); handle(stream, headers); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/proxy?tenant=one`, close: () => { for (const session of sessions) session.destroy(); server.close(); } };
}
const common = { model: "chirp-3-hd", voice: "Kore", language: "en-US", output: { format: "pcm" } } as const;
const auth = { google: { accessToken: "loopback-token", quotaProject: "quota-project" } };

test("Google native adapter streams early audio, frames its config first, and half-closes after input", { timeout: 5000 }, async () => {
  const messages: Buffer[] = []; let ended = false;
  const server = await serve((stream, headers) => {
    assert.equal(headers.authorization, "Bearer loopback-token");
    assert.equal(headers["x-goog-user-project"], "quota-project");
    assert.equal(headers[":path"], "/proxy/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize?tenant=one");
    stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
    stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
    let pending = Buffer.alloc(0);
    stream.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
        assert.equal(pending[0], 0);
        const length = pending.readUInt32BE(1);
        messages.push(pending.subarray(5, 5 + length)); pending = pending.subarray(5 + length);
        if (messages.length > 1) {
          stream.write(Buffer.from([0, 0])); stream.write(Buffer.from([0, 0, 3, 10, 1, messages.length]));
        }
      }
    });
    stream.on("end", () => { ended = true; assert.equal(pending.length, 0); stream.end(); });
  });
  let resume!: () => void; const paused = new Promise<void>(resolve => { resume = resolve; });
  const text = (async function* () { yield "hi"; await paused; yield "bye"; })();
  try {
    const result = synthesize({ ...common, text }, { auth, grpcUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(2) });
    assert.equal(ended, false);
    resume();
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(3) });
    assert.deepEqual(await result.next(), { done: true, value: undefined });
    assert.deepEqual(messages.slice(1), [Buffer.from([18, 4, 10, 2, 104, 105]), Buffer.from([18, 5, 10, 3, 98, 121, 101])]);
    // Independent protobuf fixture: locale/voice, PCM enum 7, speaking_rate=1.
    const voice = Buffer.from("en-US-Chirp3-HD-Kore");
    const selectedVoice = Buffer.concat([Buffer.from([10, 5]), Buffer.from("en-US"), Buffer.from([18, voice.length]), voice]);
    const audio = Buffer.from([8, 7, 25, 0, 0, 0, 0, 0, 0, 240, 63]);
    const config = Buffer.concat([Buffer.from([10, selectedVoice.length]), selectedVoice, Buffer.from([34, audio.length]), audio]);
    assert.deepEqual(messages[0], Buffer.concat([Buffer.from([10, config.length]), config]));
  } finally { resume(); server.close(); }
});

test("Google native adapter propagates auth rejection while input is stalled", { timeout: 5000 }, async () => {
  let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<string>>(() => {}), return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const server = await serve(stream => { stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": "16", "grpc-message": "Bad%20token" }, { endStream: true }); });
  try {
    await assert.rejects(synthesize({ ...common, text }, { auth, grpcUrl: server.url }).next(), { name: "GrpcError", statusCode: 16, message: "Bad token" });
    assert.equal(returned, 1);
  } finally { server.close(); }
});

test("Google native adapter abort closes HTTP/2 even before response headers", { timeout: 5000 }, async () => {
  let ready!: () => void; const opened = new Promise<void>(resolve => { ready = resolve; });
  let disconnected!: () => void; const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = await serve(stream => { stream.on("close", disconnected); ready(); });
  const controller = new AbortController();
  try {
    const result = synthesize({ ...common, text: "hi" }, { auth, grpcUrl: server.url, signal: controller.signal }).next();
    await opened; controller.abort(new Error("barge in"));
    await assert.rejects(result, { name: "Error", message: "barge in" }); await closed;
  } finally { controller.abort(); server.close(); }
});
