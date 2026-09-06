import http2 from "node:http2";
import tls from "node:tls";
import { readFileSync } from "node:fs";

const [mode, cert, key] = process.argv.slice(2);
const options = { settings: { initialWindowSize: mode === "blocked" ? 0 : 1024 } };
if (cert) Object.assign(options, { cert: readFileSync(cert), key: readFileSync(key) });
const server = mode === "no-alpn" ? tls.createServer(options, socket => socket.on("error", () => {}))
  : cert ? http2.createSecureServer(options) : http2.createServer(options);
server.on("tlsClientError", () => {});
server.on("session", session => session.on("error", () => {}));
server.on("stream", (stream, headers) => {
  process.stdout.write(JSON.stringify({ headers }) + "\n");
  stream.on("error", () => {});
  stream.on("close", () => process.stdout.write('"closed"\n'));
  stream.respond({ ":status": 200, "content-type": "application/grpc", "x-huffman": "www.example.com" }, { waitForTrailers: true });
  stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
  const reply = bytes => {
    const prefix = Buffer.alloc(5); prefix.writeUInt32BE(bytes.length, 1);
    // Neither message nor frame boundaries line up with client reads.
    stream.write(prefix.subarray(0, 2)); stream.write(prefix.subarray(2)); stream.write(bytes);
  };
  if (mode === "blocked") { reply(Buffer.from("early")); return; }
  let pending = Buffer.alloc(0);
  stream.on("data", data => {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
      const size = pending.readUInt32BE(1);
      reply(pending.subarray(5, 5 + size)); pending = pending.subarray(5 + size);
    }
  });
  stream.on("end", () => stream.end());
});
server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\n"));
