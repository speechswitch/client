import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest, objectFields, providerRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/hume.ts";
import type { JsonValue } from "../../../playground/src/lib/provider-schema.ts";

const provider = providerSchemasFromSpeechSpec(extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname)).find(({ id }) => id === "hume")!;
test("Hume model selection changes the generated form's acting and timestamp controls", () => {
  for (const schema of [provider.request, provider.streamingText!.request]) {
    const fields1 = objectFields(schema, { model: "octave-1", voice: "saved", text: "Hi" }).map(field => field.name);
    const fields2 = objectFields(schema, { model: "octave-2", voice: "saved", text: "Hi" }).map(field => field.name);
    assert.deepEqual(fields1.filter(name => ["instructions", "timestampGranularity", "voiceDescription"].includes(name)).sort(), ["instructions", "voiceDescription"]);
    assert.deepEqual(fields2.filter(name => ["instructions", "timestampGranularity", "voiceDescription"].includes(name)), ["timestampGranularity"]);
    assert.deepEqual(objectFields(schema, { model: "octave-2" }).find(field => field.name === "model")!.schema, { kind: "enum", values: ["octave-1", "octave-2"] });
  }
});
test("Hume forms materialize ID/name/design selection and leave provider-dependent temperature absent", () => {
  const requests: Record<string, JsonValue>[] = [
    { model: "octave-1", text: "Hi", voiceDescription: "Warm narrator", output: { format: "wav" } },
    { model: "octave-1", text: "Hi", voiceName: "Ava", voiceSource: "catalog", instructions: "Whisper", output: { format: "wav" } },
    { model: "octave-2", text: "Hi", voice: "saved", voiceSource: "custom", output: { format: "wav" } },
  ];
  for (const request of requests) {
    const actual = materializedRequest(provider, request);
    assert.deepEqual(actual, { ...request, speed: 1, trailingSilenceMs: 0, splitTurns: true }); validateRequest(actual);
  }
});
test("Hume dialogue materialization does not override request-wide speed or silence with turn defaults", () => {
  const request: Record<string, JsonValue> = { model: "octave-2", output: { format: "pcm" }, speed: 1.2, trailingSilenceMs: 250,
    speakers: [{ alias: "a", voice: "saved" }], turns: [{ speaker: "a", text: "Hi" }, { speaker: "a", text: "Again", speed: 0.5, trailingSilenceMs: 0 }] };
  const actual = materializedRequest(provider, request);
  assert.deepEqual(actual, { ...request, splitTurns: true, speakers: [{ alias: "a", voice: "saved", voiceSource: "custom" }] }); validateRequest(actual);
});
test("Hume streaming forms exclude HTTP-only controls and still materialize executable text iterators", async () => {
  assert.equal(objectFields(provider.streamingText!.request, { model: "octave-2" }).some(field => field.name === "splitTurns"), false);
  const actual = providerRequest({ model: "octave-2", voice: "saved", output: { format: "pcm" }, text: [{ text: "Hel" }, { text: "lo" }] }, provider.streamingText) as { text: AsyncIterable<string> };
  const validate = validateRequest(actual);
  const chunks = await Array.fromAsync(actual.text); assert.deepEqual(chunks, ["Hel", "lo"]); for (const chunk of chunks) validate(chunk);
});
