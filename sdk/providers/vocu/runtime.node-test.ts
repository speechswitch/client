import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { Socket } from "node:net";
import { synthesize } from "./index.ts";

async function serve(receive: (request: IncomingMessage, response: ServerResponse, body: unknown) => void) {
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => receive(request, response, chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined));
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}`, close() { for (const socket of sockets) socket.destroy(); server.close(); } };
}
const request = { voice: "owned", text: "Hello" } as const;
const auth = { vocu: { apiKey: "loopback-key" } };

test("Vocu native Node fetch streams before EOF and resolves environment authentication", { timeout: 5000 }, async () => {
  const previous = process.env.SPEECHSWITCH_VOCU_API_KEY; process.env.SPEECHSWITCH_VOCU_API_KEY = "environment-key";
  const closed = Promise.withResolvers<void>();
  const server = await serve((req, res, body) => {
    assert.equal(req.url, "/api/tts/simple-generate"); assert.equal(req.headers.authorization, "Bearer environment-key");
    assert.deepEqual(body, { voiceId: "owned", text: "Hello", promptId: "default", preset: "balance", language: "auto", vivid: false, speechRate: 1, seed: -1,
      flash: false, srt: false, stream: true, direct_stream: true });
    res.on("close", () => closed.resolve()); res.writeHead(200, { "content-type": "audio/mpeg" }); res.write(Buffer.from([0, 255, 128]));
  });
  try {
    const stream = synthesize(request, { baseUrl: server.url });
    assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(0, 255, 128) });
    await stream.return?.(); await closed.promise;
  } finally { if (previous === undefined) delete process.env.SPEECHSWITCH_VOCU_API_KEY; else process.env.SPEECHSWITCH_VOCU_API_KEY = previous; server.close(); }
});

test("Vocu native async lifecycle polls then downloads once without authorization leakage", { timeout: 5000 }, async () => {
  const calls: string[] = []; let final: object;
  const server = await serve((req, res, body) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.url === "/audio.mp3") { assert.equal(req.headers.authorization, undefined); res.writeHead(200, { "content-type": "audio/mpeg" }); res.end(Buffer.from([1, 2])); return; }
    assert.equal(req.headers.authorization, "Bearer loopback-key"); res.writeHead(200, { "content-type": "application/json", "x-vocu-app-request-id": "trace" });
    if (req.method === "POST") {
      assert.deepEqual(body, { contents: [{ type: "text", voiceId: "owned", text: "Hello", promptId: "default", preset: "balance", language: "auto", vivid: false, speechRate: 1, seed: -1 }], srt: false });
      res.end(JSON.stringify({ status: 200, data: { id: "job", status: "pending" } }));
    } else {
      final = { id: "job", status: "generated", metadata: { audio: `${server.url}/audio.mp3`, name: "😀" } };
      const encoded = Buffer.from(JSON.stringify({ status: 200, data: final })); const split = encoded.indexOf(Buffer.from("😀")) + 1;
      res.write(encoded.subarray(0, split)); setImmediate(() => res.end(encoded.subarray(split)));
    }
  });
  try {
    const result = await Array.fromAsync(synthesize({ segments: [{ kind: "speech", ...request }] }, { auth, baseUrl: server.url, audioOrigins: [server.url], pollIntervalMs: 0 }));
    assert.deepEqual(calls, ["POST /api/tts/generate", "GET /api/tts/generate/job", "GET /audio.mp3"]);
    assert.deepEqual(result, [Uint8Array.of(1, 2), { event: "done", completion: "generated", metadata: final!, requestId: "trace" }]);
  } finally { server.close(); }
});

test("Vocu native pending audio read is canceled and disconnected", { timeout: 5000 }, async () => {
  const controller = new AbortController(); const closed = Promise.withResolvers<void>();
  const server = await serve((_req, res) => { res.on("close", () => closed.resolve()); res.writeHead(200, { "content-type": "audio/mpeg" }); res.write(Buffer.from([1])); });
  try {
    const stream = synthesize(request, { auth, baseUrl: server.url, signal: controller.signal });
    assert.deepEqual(await stream.next(), { done: false, value: Uint8Array.of(1) });
    const pending = stream.next(); controller.abort(new Error("stop"));
    await assert.rejects(pending, { name: "Error", message: "stop" }); await closed.promise;
  } finally { controller.abort(); server.close(); }
});
