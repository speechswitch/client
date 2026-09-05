import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/microsoft.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "microsoft")!;

test("Microsoft playground materializes model-specific defaults from TypeScript", () => {
  const request = materializedRequest(provider, { text: "Hello", voice: "en-US-Ava", model: "dragon-hd-omni" });
  assert.deepEqual(request, { text: "Hello", voice: "en-US-Ava", model: "dragon-hd-omni", temperature: 0.7, topP: 0.7, topK: 22, voiceGuidance: 1.4 });
  validateRequest(request);
});
test("Microsoft playground exposes prosody only on the neural model", () => {
  const neural = objectFields(provider.request, { model: "neural" });
  const hd = objectFields(provider.request, { model: "dragon-hd" });
  const relevant = (fields: typeof neural) => fields.filter(field => ["speed", "pitchSemitones", "temperature", "topK"].includes(field.name)).map(field => field.name);
  assert.deepEqual(relevant(neural), ["pitchSemitones", "speed"]);
  assert.deepEqual(relevant(hd), ["temperature"]);
});
test("Microsoft incremental Omni does not acquire SSML-only sampling knobs", () => {
  const fields = objectFields(provider.streamingText!.request, { model: "dragon-hd-omni" });
  assert.deepEqual(fields.filter(field => ["topP", "topK", "voiceGuidance", "temperature"].includes(field.name)).map(field => [field.name, field.default]), [["temperature", 0.7]]);
});
