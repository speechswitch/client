import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type ServerHttp2Stream, type IncomingHttpHeaders } from "node:http2";
import { once } from "node:events";
import { connectGrpc } from "./grpc.ts";

async function serve(handle: (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => void) {
  const server = createServer();
  const sessions = new Set<import("node:http2").ServerHttp2Session>();
  server.on("session", session => { sessions.add(session); session.on("error", () => {}); session.on("close", () => sessions.delete(session)); });
  server.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => { stream.on("error", () => {}); handle(stream, headers); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize?tenant=one`, close: () => { for (const session of sessions) session.destroy(); server.close(); } };
}

test("gRPC uses native authenticated HTTP/2 with binary frames, half-close, fragmented audio and final trailers", { timeout: 5000 }, async () => {
  const received: Buffer[] = [];
  const server = await serve((stream, headers) => {
    assert.equal(headers[":method"], "POST");
    assert.equal(headers[":path"], "/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize?tenant=one");
    assert.equal(headers.authorization, "Bearer test");
    assert.equal(headers["content-type"], "application/grpc"); assert.equal(headers.te, "trailers");
    stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
    stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
    stream.on("data", chunk => {
      assert.ok(Buffer.isBuffer(chunk));
      received.push(chunk);
      stream.write(Buffer.from([0, 0, 0])); stream.write(Buffer.from([0, 2, 10, 0]));
    });
    stream.on("end", () => { stream.end(Buffer.from([0, 0, 0, 0, 3, 10, 1, 7])); });
  });
  const controller = new AbortController();
  try {
    const connection = await connectGrpc({ url: server.url, headers: { authorization: "Bearer test" }, signal: controller.signal });
    const output = connection.responses[Symbol.asyncIterator]();
    await connection.write(Uint8Array.of(18, 2, 10, 0));
    // The server can send audio before input half-close.
    assert.deepEqual(await output.next(), { done: false, value: Uint8Array.of(10, 0) });
    connection.end();
    assert.deepEqual(await output.next(), { done: false, value: Uint8Array.of(10, 1, 7) });
    assert.deepEqual(await output.next(), { done: true, value: undefined });
    assert.deepEqual(Buffer.concat(received), Buffer.from([0, 0, 0, 0, 4, 18, 2, 10, 0]));
  } finally { controller.abort(); server.close(); }
});

test("gRPC trailers-only rejection preserves status and decoded message", { timeout: 5000 }, async () => {
  const server = await serve(stream => { stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": "16", "grpc-message": "Bad%20token%21" }, { endStream: true }); });
  try {
    const connection = await connectGrpc({ url: server.url, headers: {}, signal: new AbortController().signal });
    await assert.rejects(Array.fromAsync(connection.responses), { name: "GrpcError", statusCode: 16, message: "Bad token!" });
  } finally { server.close(); }
});

test("gRPC cancellation releases a pending response before headers", { timeout: 5000 }, async () => {
  let opened!: () => void; const ready = new Promise<void>(resolve => { opened = resolve; });
  let disconnected!: () => void; const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = await serve(stream => { stream.on("close", disconnected); opened(); });
  const controller = new AbortController();
  try {
    const connection = await connectGrpc({ url: server.url, headers: {}, signal: controller.signal });
    const output = Array.fromAsync(connection.responses); await ready;
    controller.abort(new Error("cancel Google"));
    await assert.rejects(output, { name: "Error", message: "cancel Google" }); await closed;
  } finally { controller.abort(); server.close(); }
});

for (const fixture of [
  { name: "missing final status", bytes: [], status: undefined, message: "gRPC response lacks a valid final status" },
  { name: "truncated message", bytes: [0, 0, 0, 0, 2, 1], status: "0", message: "Truncated gRPC message" },
  { name: "compression", bytes: [1, 0, 0, 0, 0], status: "0", message: "Compressed gRPC messages are not supported" },
  { name: "oversized frame", bytes: [0, 4, 0, 0, 1], status: "0", message: "gRPC message exceeds 64 MiB" },
]) {
  test(`gRPC rejects ${fixture.name}`, { timeout: 5000 }, async () => {
    const server = await serve(stream => {
      stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers(fixture.status === undefined ? {} : { "grpc-status": fixture.status }));
      stream.end(Buffer.from(fixture.bytes));
    });
    try {
      const connection = await connectGrpc({ url: server.url, headers: {}, signal: new AbortController().signal });
      await assert.rejects(Array.fromAsync(connection.responses), { name: "TypeError", message: fixture.message });
    } finally { server.close(); }
  });
}
