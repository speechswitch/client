import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { Socket } from "node:net";
import { synthesize } from "./index.ts";

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const sockets = new Set<Socket>(); const server = createServer(handler);
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}`, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}
const output = { status: "succeeded", text: "Hi", speaker: "voice", speakerStyle: "style", speed: 1, pause: [], emphasis: [], pronunciations: [] };
const job = { id: "job/1", type: "tts", status: "done", progress: 1, team: "team", createdAt: "2026-09-05T00:00:00Z" };
const request = { text: "Hi", voice: "voice" };
const auth = { lovo: { apiKey: "loopback-key" } };

test("LOVO native HTTP sends header auth, polls pending jobs and streams a credential-free file", { timeout: 5000 }, async () => {
  const previous = process.env.SPEECHSWITCH_LOVO_API_KEY; process.env.SPEECHSWITCH_LOVO_API_KEY = "environment-key";
  const calls: string[] = []; let finish!: () => void;
  const server = await serve((incoming, response) => {
    calls.push(incoming.url!);
    if (incoming.method === "POST") {
      assert.equal(incoming.headers["x-api-key"], "environment-key"); const chunks: Buffer[] = [];
      incoming.on("data", chunk => chunks.push(chunk)); incoming.on("end", () => {
        assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { text: "Hi", speaker: "voice", speed: 1 });
        response.writeHead(201, { "content-type": "application/json" }); response.end(JSON.stringify({ ...job, status: "in_progress", data: [] }));
      });
    } else if (incoming.url!.startsWith("/proxy/api/v1/tts/")) {
      assert.equal(incoming.headers["x-api-key"], "environment-key"); response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...job, callbackUrls: [], data: [{ ...output, urls: [`${server.url}/audio`] }] }));
    } else {
      assert.equal(incoming.headers["x-api-key"], undefined); assert.equal(incoming.headers.authorization, undefined); assert.equal(incoming.headers.cookie, undefined);
      response.writeHead(200, { "content-type": "audio/wav" }); response.write(Buffer.from([1])); finish = () => response.end(Buffer.from([2]));
    }
  });
  try {
    const result = synthesize(request, { baseUrl: `${server.url}/proxy/?tenant=one`, pollIntervalMs: 0 });
    assert.deepEqual(await result.next(), { done: false, value: { correlation: "ordered", correlationId: "job/1:0:0", inputGroupId: "job/1:0", audio: Uint8Array.of(1), timestamps: [] } });
    finish(); assert.deepEqual(await Array.fromAsync(result), [{ correlation: "ordered", correlationId: "job/1:0:0", inputGroupId: "job/1:0", audio: Uint8Array.of(2), timestamps: [] }]);
    assert.deepEqual(calls, ["/proxy/api/v1/tts/sync?tenant=one", "/proxy/api/v1/tts/job%2F1?tenant=one", "/audio"]);
  } finally { if (previous === undefined) delete process.env.SPEECHSWITCH_LOVO_API_KEY; else process.env.SPEECHSWITCH_LOVO_API_KEY = previous; server.close(); }
});

test("LOVO never forwards API credentials through a redirect", { timeout: 5000 }, async () => {
  let calls = 0;
  const server = await serve((_incoming, response) => { calls++; response.writeHead(302, { location: "/unexpected" }); response.end(); });
  try { await assert.rejects(synthesize(request, { auth, baseUrl: server.url }).next(), { name: "TypeError", message: "fetch failed" }); assert.equal(calls, 1); }
  finally { server.close(); }
});

test("LOVO abort terminates native audio download without pretending to cancel server-side synthesis", { timeout: 5000 }, async () => {
  let disconnect!: () => void; const disconnected = new Promise<void>(resolve => { disconnect = resolve; });
  const calls: string[] = []; const controller = new AbortController();
  const server = await serve((incoming, response) => {
    calls.push(incoming.url!);
    if (incoming.method === "POST") { response.writeHead(201, { "content-type": "application/json" }); response.end(JSON.stringify({ ...job, data: [{ ...output, urls: [`${server.url}/audio`] }] })); }
    else { response.on("close", disconnect); response.writeHead(200); response.write(Buffer.from([1])); }
  });
  try {
    const result = synthesize(request, { auth, baseUrl: server.url, signal: controller.signal }); await result.next(); const pending = result.next();
    controller.abort(new Error("stop")); await assert.rejects(pending, { name: "Error", message: "stop" }); await disconnected;
    assert.deepEqual(calls, ["/api/v1/tts/sync", "/audio"]);
  } finally { controller.abort(); server.close(); }
});
