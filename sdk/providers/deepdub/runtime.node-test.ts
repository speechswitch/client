import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { DeepdubError, synthesize } from "./index.ts";

const request = { model: "phantom-x-3.2", voice: "custom-voice", text: "hello", language: "en-US", output: { format: "mp3" } } as const;
const auth = { deepdub: { apiKey: "loopback-key" } } as const;

test("Deepdub streams native Node HTTP immediately and releases a cancelled connection", { timeout: 5000 }, async () => {
  let responseClosed!: () => void;
  const closed = new Promise<void>(resolve => { responseClosed = resolve; });
  const server = createServer(async (incoming, response) => {
    assert.equal(incoming.url, "/api/v1/tts"); assert.equal(incoming.headers["x-api-key"], "loopback-key");
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, "dd-etts-3.2"); assert.equal(body.voicePromptId, "custom-voice"); assert.equal(body.format, "mp3");
    response.writeHead(200, { "content-type": "audio/mpeg" }); response.write(Buffer.from([1, 2]));
    response.on("close", responseClosed);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const stream = synthesize(request, { auth, baseUrl: `http://127.0.0.1:${address.port}/api/v1`, signal: controller.signal });
  try {
    assert.deepEqual((await stream.next()).value, Uint8Array.of(1, 2));
    const pending = stream.next(); controller.abort(new Error("stop audio"));
    await assert.rejects(pending, /stop audio/); await closed;
  } finally { controller.abort(); await stream.return?.(); server.closeAllConnections(); server.close(); }
});

test("Deepdub native Node HTTP carries inline reference audio and returns the final bytes", { timeout: 5000 }, async () => {
  let finish!: () => void;
  const server = createServer(async (incoming, response) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.voiceReference, "AQID"); assert.equal(body.voicePromptId, undefined); assert.equal(body.targetDuration, 1.5);
    response.writeHead(200, { "content-type": "audio/basic" }); response.write(Buffer.from([1])); finish = () => response.end(Buffer.from([2]));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const stream = synthesize({ ...request, voice: undefined, referenceAudio: Uint8Array.of(1, 2, 3), targetDurationMs: 1500, output: { format: "mulaw" } }, { auth, baseUrl: `http://127.0.0.1:${address.port}` });
  try {
    assert.deepEqual((await stream.next()).value, Uint8Array.of(1)); finish();
    assert.deepEqual((await stream.next()).value, Uint8Array.of(2)); assert.equal((await stream.next()).done, true);
  } finally { await stream.return?.(); server.closeAllConnections(); server.close(); }
});

test("Deepdub native Node HTTP preserves upstream errors and rejects mislabeled Opus", { timeout: 5000 }, async () => {
  let calls = 0;
  const server = createServer((_incoming, response) => {
    if (calls++ === 0) {
      response.writeHead(400, { "content-type": "application/json", "x-generation-id": "upstream-generation" });
      response.end(JSON.stringify({ success: false, message: "Internal error" })); return;
    }
    const bytes = Buffer.alloc(40); bytes.write("OggS"); bytes[5] = 2; bytes[26] = 1; bytes[27] = 30; bytes.write("\x01vorbis", 28);
    response.writeHead(200, { "content-type": "application/ogg" }); response.end(bytes);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const options = { auth, baseUrl: `http://127.0.0.1:${address.port}` };
  try {
    await assert.rejects(synthesize(request, options).next(), error => {
      assert.ok(error instanceof DeepdubError); assert.equal(error.statusCode, 400); assert.equal(error.generationId, "upstream-generation"); return true;
    });
    await assert.rejects(synthesize({ ...request, output: { format: "ogg_opus" } }, options).next(), /Vorbis/);
  } finally { server.closeAllConnections(); server.close(); }
});
