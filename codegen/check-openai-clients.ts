import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { renderOpenaiClients } from "./openai-client.ts";

const root = path.resolve(import.meta.dirname, "..");
const raw = YAML.parse(await readFile(path.join(root, "schemas/sources/openai/00-openapi.yaml"), "utf8"));
raw.servers[0].url = "https://changed.invalid/root";
raw.paths["/changed/speech"] = raw.paths["/audio/speech"]; delete raw.paths["/audio/speech"];
const responses = raw.paths["/changed/speech"].post.responses;
responses["201"] = responses["200"]; delete responses["200"];
const input = raw.components.schemas.CreateSpeechRequest;
input.properties.input.maxLength = 2;
input.properties.enabled = { type: "boolean" }; input.required.push("enabled");
input.properties.fraction = { type: "number", enum: [0.25, 0.75] };
raw.components.schemas.SpeechAudioDoneEvent.properties.type.enum = ["speech.completed"];
raw.components.schemas.SpeechAudioDoneEvent.properties.usage.properties.input_tokens = { type: "string", minLength: 1 };
const directory = await mkdtemp(path.join(tmpdir(), "speechswitch-openai-wire-"));
try {
  const file = path.join(directory, "wire.py");
  const clients = renderOpenaiClients(raw, "fixture");
  await writeFile(file, clients.python);
  const env = { ...process.env, PYTHONPATH: [directory, path.join(root, "sdks/python")].join(path.delimiter) };
  for (const [command, args] of [
    ["pyright", ["--project", path.join(root, "sdks/python/pyproject.toml"), file]],
    ["python3", [path.join(root, "codegen/fixtures/openai-python/client.py")]],
  ] as const) {
    const result = spawnSync(command, args, { env, encoding: "utf8" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command}\n${result.stdout}\n${result.stderr}`);
  }
  await writeFile(path.join(directory, "go.mod"), `module openaiwirefixture\n\ngo 1.23\n\nrequire github.com/speechswitch/client/sdks/go v0.0.0\nreplace github.com/speechswitch/client/sdks/go => ${JSON.stringify(path.join(root, "sdks/go"))}\n`);
  await writeFile(path.join(directory, "client.go"), clients.go);
  await writeFile(path.join(directory, "client_test.go"), await readFile(path.join(root, "codegen/fixtures/openai-go/client_test.go"), "utf8"));
  const result = spawnSync("go", ["test", "-count=1", "."], { cwd: directory, env: { ...process.env, GOWORK: "off", GOPROXY: "off", GOSUMDB: "off" }, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `go test changed OpenAI client\n${result.stdout}\n${result.stderr}`);
  await writeFile(path.join(directory, "client.rs"), clients.rust);
  await writeFile(path.join(directory, "main.rs"), `pub use speechswitch_types::{runtime, http};
#[path = ${JSON.stringify(path.join(root, "sdks/rust/src/json.rs"))}] mod json;
#[path = ${JSON.stringify(path.join(root, "sdks/rust/src/endpoint.rs"))}] mod endpoint;
mod client;
#[path = ${JSON.stringify(path.join(root, "codegen/fixtures/openai-rust/client.rs"))}] mod tests;
`);
  for (const [command, args] of [
    ["rustc", ["--edition=2021", "--test", "--extern", `speechswitch_types=${path.join(root, "sdks/rust/target/debug/libspeechswitch_types.rlib")}`, "-o", path.join(directory, "rust-test"), path.join(directory, "main.rs")]],
    [path.join(directory, "rust-test"), []],
  ] as const) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command}\n${result.stdout}\n${result.stderr}`);
  }
  console.log("Verified generated OpenAI Python/Go/Rust wire constraints, events, routes, auth and status against changed OpenAPI");
} finally {
  await rm(directory, { recursive: true, force: true });
}
