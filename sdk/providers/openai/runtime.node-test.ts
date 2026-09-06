import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { synthesize } from "./index.ts";

async function serve(handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handle); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/proxy/v1?tenant=one`, close: () => { server.closeAllConnections(); server.close(); } };
}
test("OpenAI native Node fetch delivers byte-native audio before HTTP completion", { timeout: 5000 }, async () => {
  let finish!: () => void;
  const server = await serve((request, response) => {
    assert.equal(request.url, "/proxy/v1/audio/speech?tenant=one"); assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer loopback-key");
    const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { model: "tts-1", input: "Hello", voice: "alloy", response_format: "pcm", speed: 1, stream_format: "audio" });
      response.writeHead(200, { "Content-Type": "application/octet-stream", "x-request-id": "req-native" });
      response.write(Uint8Array.of(0, 255, 128)); finish = () => response.end();
    });
  });
  try {
    const result = synthesize({ text: "Hello", voice: "alloy" }, { auth: { openai: { apiKey: "loopback-key" } }, baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(0, 255, 128) });
    finish(); assert.deepEqual(await Array.fromAsync(result), [{ event: "done", requestId: "req-native" }]);
  } finally { server.close(); }
});
test("OpenAI native Node consumer return cancels unfinished SSE transport", { timeout: 5000 }, async () => {
  let closed!: Promise<unknown>;
  const server = await serve((_, response) => {
    closed = once(response, "close"); response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write('data: {"type":"speech.audio.delta","audio":"AQI="}\n\n');
  });
  try {
    const result = synthesize({ text: "Hello", voice: "cedar", model: "gpt-4o-mini-tts", includeUsage: true }, { auth: { openai: { apiKey: "key" } }, baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(1, 2) });
    await result.return!(undefined); await closed;
  } finally { server.close(); }
});
