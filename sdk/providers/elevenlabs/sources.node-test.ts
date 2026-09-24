import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";

function snapshot(name: string) {
  const text = readFileSync(new URL(`../../../schemas/sources/elevenlabs/${name}`, import.meta.url), "utf8");
  const section = text.split("```yaml\n")[1];
  assert.ok(section, `Missing AsyncAPI in ${name}`);
  return YAML.parse(section.split("\n```")[0]!);
}

const tts = snapshot("06-tts-websocket.md");
const dialogue = snapshot("07-dialogue-websocket.md");
const multi = snapshot("08-multi-websocket.md");

test("ElevenLabs socket contracts leave every handshake query value untyped", () => {
  const ttsFields = ["authorization", "single_use_token", "model_id", "language_code", "enable_logging", "output_format", "inactivity_timeout", "sync_alignment", "auto_mode", "apply_text_normalization", "seed", "enable_ssml_parsing"];
  assert.deepEqual(tts.channels["/v1/text-to-speech/{voice_id}/stream-input"].bindings.ws.query,
    { type: "object", properties: Object.fromEntries(ttsFields.map(name => [name, { description: "Any type" }])) });
  assert.deepEqual(multi.channels["/v1/text-to-speech/{voice_id}/multi-stream-input"].bindings.ws.query,
    { type: "object", properties: Object.fromEntries(ttsFields.map(name => [name, { description: "Any type" }])) });
  assert.deepEqual(dialogue.channels["/v1/text-to-dialogue/stream-input"].bindings.ws.query,
    { type: "object", properties: Object.fromEntries(["model_id", "output_format", "language_code", "sync_alignment", "apply_text_normalization", "seed", "enable_logging"].map(name => [name, { description: "Any type" }])) });
});

test("the original TTS auth spelling disagrees with the multi-context schema", () => {
  const original = tts.components.schemas.InitializeConnection.properties;
  const contexts = multi.components.schemas.InitializeConnectionMulti.properties;
  assert.equal(original["xi-api-key"].type, "string");
  assert.equal(original.xi_api_key, undefined);
  assert.equal(contexts.xi_api_key.type, "string");
  assert.equal(contexts["xi-api-key"], undefined);
});

test("multi-context schemas omit required correlation and use camel-case output fields", () => {
  const schemas = multi.components.schemas;
  assert.deepEqual(Object.keys(schemas.AudioOutputMulti.properties), ["audio", "normalizedAlignment", "alignment", "contextId"]);
  assert.deepEqual(schemas.AudioOutputMulti.required, ["audio"]);
  assert.deepEqual(Object.keys(schemas.FinalOutputMulti.properties), ["isFinal", "contextId"]);
  assert.deepEqual(schemas.FinalOutputMulti.required, ["isFinal"]);
});

test("v3 dialogue voice settings expose only bounded stability", () => {
  const settings = dialogue.components.schemas.TextToDialogueWebsocketVoiceSettings.properties;
  assert.deepEqual(Object.keys(settings), ["stability"]);
  const { type, minimum, maximum, default: defaultValue } = settings.stability;
  assert.deepEqual({ type, minimum, maximum, default: defaultValue }, { type: "number", minimum: 0, maximum: 1, default: 0.5 });
});
