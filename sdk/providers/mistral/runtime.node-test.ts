import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { synthesize } from "./index.ts";

async function serve(handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handle); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/proxy?tenant=one`, close: () => { server.closeAllConnections(); server.close(); } };
}
test("Mistral native Node fetch streams before HTTP completion and sends header auth", { timeout: 5000 }, async () => {
  let finish!: () => void;
  const server = await serve((request, response) => {
    assert.equal(request.url, "/proxy/v1/audio/speech?tenant=one"); assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer loopback-key");
    const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { model: "voxtral-mini-tts-2603", input: "Hello", voice_id: "saved-voice", stream: true, response_format: "pcm" });
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('event: speech.audio.delta\r\ndata: {"audio_data":"AADAPw=="}\r\n\r\n');
      finish = () => response.end('event: speech.audio.done\r\ndata: {"usage":{"completion_tokens":null}}\r\n\r\n');
    });
  });
  try {
    const result = synthesize({ text: "Hello", voice: "saved-voice" }, { auth: { mistral: { apiKey: "loopback-key" } }, baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(0, 0, 192, 63) });
    finish(); assert.deepEqual(await Array.fromAsync(result), [{ event: "done", usage: { completionTokens: null } }]);
  } finally { server.close(); }
});
test("Mistral native Node consumer return cancels an unfinished response", { timeout: 5000 }, async () => {
  let closed!: Promise<unknown>;
  const server = await serve((_, response) => {
    closed = once(response, "close"); response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write('event: speech.audio.delta\ndata: {"audio_data":"AQI="}\n\n');
  });
  try {
    const result = synthesize({ text: "Hello" }, { auth: { mistral: { apiKey: "key" } }, baseUrl: server.url });
    assert.deepEqual(await result.next(), { done: false, value: Uint8Array.of(1, 2) });
    await result.return!(undefined); await closed;
  } finally { server.close(); }
});
