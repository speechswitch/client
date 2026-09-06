import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderCambClient } from "./camb-client.ts";

const root = path.resolve(import.meta.dirname, "..");
const http = JSON.parse(await readFile(path.join(root, "schemas/sources/camb/00-openapi.json"), "utf8"));
const live = JSON.parse(await readFile(path.join(root, "schemas/sources/camb/01-asyncapi.json"), "utf8"));
const schema = http.components.schemas.CreateStreamTTSRequestPayload;
schema.properties.text = { type: "integer", minimum: 5, maximum: 9 };
schema.properties.extra_flag = { type: "boolean" };
schema.required.push("extra_flag");
http.paths["/new-tts"] = http.paths["/tts-stream"];
delete http.paths["/tts-stream"];
http.components.securitySchemes.APIKeyHeader.name = "new-key";
http.servers[0].url = "https://new.invalid/api";
live.servers.production.host = "live.invalid";
live.components.messages.Added = { name: "Added", contentType: "application/json", payload: {
  type: "object", additionalProperties: false, required: ["type", "count", "items"], properties: {
    type: { type: "string", const: "added" }, count: { type: "integer" },
    nickname: { type: "string", minLength: 2, maxLength: 2, nullable: true },
    items: { type: "array", items: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } },
    "a-b": { type: "object", properties: { flag: { type: "boolean" } } },
    a_b: { type: "object", properties: { flag: { type: "number" } } },
  },
} };
live.channels.liveTts.messages.Added = { $ref: "#/components/messages/Added" };
live.operations.serverSend.messages.push({ $ref: "#/channels/liveTts/messages/Added" });
const directory = await mkdtemp(path.join(tmpdir(), "speechswitch-camb-wire-"));
try {
  const file = path.join(directory, "wire.py");
  await writeFile(file, renderCambClient(http, live, []).python);
  const env = { ...process.env, PYTHONPATH: [directory, path.join(root, "sdks/python")].join(path.delimiter) };
  for (const [command, args] of [
    ["pyright", ["--project", path.join(root, "sdks/python/pyproject.toml"), file]],
    ["python3", [path.join(root, "codegen/fixtures/camb-python/client.py")]],
  ] as const) {
    const result = spawnSync(command, args, { env, encoding: "utf8" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command}\n${result.stdout}\n${result.stderr}`);
  }
  console.log("Verified generated CAMB Python wire types, constraints, codecs, routes and authentication against mutated contracts");
} finally {
  await rm(directory, { recursive: true, force: true });
}
