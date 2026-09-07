import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderLovoClients } from "./lovo-client.ts";

const root = path.resolve(import.meta.dirname, "..");
const raw = JSON.parse(await readFile(path.join(root, "schemas/sources/lovo/00-openapi.json"), "utf8"));
raw.servers[0].url = "https://changed.invalid/root/?tenant=one";
raw.components.securitySchemes["X-API-KEY"].name = "changed-key";
raw.paths["/new/{id}"] = { post: raw.paths["/api/v1/tts/{jobId}"].get };
delete raw.paths["/api/v1/tts/{jobId}"];
raw.paths["/new/{id}"].post.parameters[0].name = "id";
raw.paths["/new/{id}"].post.parameters[0].schema.minLength = 2;
const sync = raw.paths["/api/v1/tts/sync"].post;
sync.responses["202"] = sync.responses["201"]; delete sync.responses["201"];
const request = raw.components.schemas.TextToSpeechSyncRequest;
request.properties.text = { type: "integer", minimum: 5, maximum: 10 };
request.properties.enabled = { type: "boolean" }; request.required.push("enabled");
request.properties.nickname = { type: "string", nullable: true, minLength: 2, maxLength: 2 };
const output = raw.components.schemas.TextToSpeechOutput;
output.properties.status.enum = ["new_status"];
output.properties.urls.items = { type: "integer" }; output.required.push("urls");
raw.components.schemas.Emphasis.properties.value.enum = [0.1, 0.9];
const directory = await mkdtemp(path.join(tmpdir(), "speechswitch-lovo-wire-"));
try {
  const file = path.join(directory, "wire.py");
  await writeFile(file, renderLovoClients(raw, "fixture").python);
  const env = { ...process.env, PYTHONPATH: [directory, path.join(root, "sdks/python")].join(path.delimiter) };
  for (const [command, args] of [
    ["pyright", ["--project", path.join(root, "sdks/python/pyproject.toml"), file]],
    ["python3", [path.join(root, "codegen/fixtures/lovo-python/client.py")]],
  ] as const) {
    const result = spawnSync(command, args, { env, encoding: "utf8" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command}\n${result.stdout}\n${result.stderr}`);
  }
  console.log("Verified generated LOVO Python wire constraints, nested responses, routes, authentication and status against changed OpenAPI");
} finally {
  await rm(directory, { recursive: true, force: true });
}
