import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { synthesize } from "./index.ts";

async function serve(handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handle); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/proxy`, close: () => { server.closeAllConnections(); server.close(); } };
}
test("Resemble native Node streams file bytes only after explicit queue completion", { timeout: 5000 }, async () => {
  let complete!: () => void; let finish!: () => void; let downloads = 0;
  const queueOpened = Promise.withResolvers<void>();
  const server = await serve((request, response) => {
    assert.equal(request.headers.authorization, "Bearer hf-loopback");
    if (request.method === "POST") {
      assert.equal(request.url, "/proxy/gradio_api/call/generate_tts_audio");
      const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk));
      request.on("end", () => {
        assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { data: ["Hello", null, 0.5, 0.8, 0, 0.5, false] });
        response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"event_id":"native"}');
      }); return;
    }
    if (request.url === "/proxy/gradio_api/call/generate_tts_audio/native") {
      response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write('event: heartbeat\ndata: null\n\n');
      complete = () => response.end('event: complete\ndata: [{"path":"/tmp/audio.wav"}]\n\n'); queueOpened.resolve(); return;
    }
    assert.equal(request.url, "/proxy/gradio_api/file=%2Ftmp%2Faudio.wav"); downloads++;
    response.writeHead(200, { "Content-Type": "audio/wav" }); response.write(Uint8Array.of(0, 255, 128)); finish = () => response.end();
  });
  try {
    const result = synthesize({ text: "Hello" }, { auth: { resemble: { token: "hf-loopback" } }, baseUrl: server.url });
    const first = result.next(); await queueOpened.promise; assert.equal(downloads, 0); complete();
    assert.deepEqual(await first, { done: false, value: Uint8Array.of(0, 255, 128) });
    finish(); assert.deepEqual(await Array.fromAsync(result), [{ event: "done", requestId: "native" }]);
  } finally { server.close(); }
});
test("Resemble native abort closes queue consumption without claiming server cancellation", { timeout: 5000 }, async () => {
  let closed!: Promise<unknown>; const queueOpened = Promise.withResolvers<void>();
  const server = await serve((request, response) => {
    if (request.method === "POST") { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"event_id":"native"}'); return; }
    closed = once(response, "close"); response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write('event: heartbeat\ndata: null\n\n'); queueOpened.resolve();
  });
  try {
    const controller = new AbortController(); const reason = new Error("stop");
    const pending = Array.fromAsync(synthesize({ text: "Hello" }, { baseUrl: server.url, signal: controller.signal }));
    await queueOpened.promise; controller.abort(reason); await assert.rejects(pending, error => error === reason); await closed;
  } finally { server.close(); }
});
