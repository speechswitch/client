import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/kugelaudio.ts";

const provider = providerSchemasFromSpeechSpec(extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname)).find(value => value.id === "kugelaudio")!;
test("KugelAudio materialization preserves auto language and static temperature defaults", () => {
  const actual = materializedRequest(provider, { text: "Hello", voice: "custom-voice", output: { format: "pcm" } });
  assert.deepEqual(actual, { text: "Hello", voice: "custom-voice", model: "kugel-3", output: { format: "pcm", sampleRateHz: 24000 },
    voiceGuidance: 2, maxAudioTokens: 2048, speed: 1, textNormalization: true, temperature: 0.4 });
  validateRequest(actual);
});
test("KugelAudio live form exposes buffering without imposing the static temperature default", () => {
  const fields = objectFields(provider.streamingText!.request, { text: "Hello", voice: "custom-voice", output: { format: "pcm" } });
  assert.deepEqual(fields.filter(field => ["temperature", "textFlushDelayMs", "textBufferThreshold"].includes(field.name)).map(field => [field.name, field.default]),
    [["temperature", undefined], ["textBufferThreshold", 10000], ["textFlushDelayMs", 500]]);
});
