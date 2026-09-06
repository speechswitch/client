import http2 from "node:http2";
import { readFileSync, readdirSync } from "node:fs";
import protobuf from "protobufjs";

const directory = new URL("../../../schemas/sources/google/", import.meta.url);
const root = new protobuf.Root();
for (const file of ["02-cloud-tts-v1.proto", "03-cloud-tts-v1beta1.proto", ...readdirSync(new URL("imports/", directory), { recursive: true }).filter(name => name.endsWith(".proto")).map(name => `imports/${name}`)]) {
  protobuf.parse(readFileSync(new URL(file, directory), "utf8"), root);
}
root.resolveAll();
const server = http2.createServer();
server.on("session", session => session.on("error", () => {}));
server.on("stream", (stream, headers) => {
  process.stdout.write(JSON.stringify({ headers }) + "\n");
  stream.on("error", () => {});
  stream.on("close", () => process.stdout.write('"closed"\n'));
  const version = headers[":path"].includes("v1beta1") ? "v1beta1" : "v1";
  const request = root.lookupType(`google.cloud.texttospeech.${version}.StreamingSynthesizeRequest`);
  const response = root.lookupType(`google.cloud.texttospeech.${version}.StreamingSynthesizeResponse`);
  stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
  stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
  let pending = Buffer.alloc(0);
  stream.on("data", data => {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
      const size = pending.readUInt32BE(1);
      const message = request.toObject(request.decode(pending.subarray(5, 5 + size)), { enums: String });
      pending = pending.subarray(5 + size);
      process.stdout.write(JSON.stringify({ request: message }) + "\n");
      if (message.input) {
        const body = Buffer.from(response.encode(response.fromObject({ audioContent: Buffer.from("native-audio") })).finish());
        const prefix = Buffer.alloc(5); prefix.writeUInt32BE(body.length, 1);
        stream.write(prefix); stream.write(body);
      }
    }
  });
  stream.on("end", () => stream.end());
});
server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\n"));
