import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/inworld.ts";

const provider = providerSchemasFromSpeechSpec(extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname)).find(value => value.id === "inworld")!;
test("Inworld form controls narrow with model and input kind", () => {
  const names = (model: string, streaming = false) => objectFields(streaming ? provider.streamingText!.request : provider.request, { model, text: "Hello" })
    .map(field => field.name).filter(name => ["temperature", "deliveryMode", "instructions", "contextBefore", "automaticTextFlushing"].includes(name)).sort();
  assert.deepEqual(names("inworld-tts-2"), ["contextBefore", "deliveryMode", "instructions"]);
  assert.deepEqual(names("inworld-tts-2-flash"), ["contextBefore", "temperature"]);
  assert.deepEqual(names("inworld-tts-1.5-max"), ["contextBefore", "temperature"]);
  assert.deepEqual(names("inworld-tts-2", true), ["automaticTextFlushing", "deliveryMode"]);
});
test("Inworld materialization leaves language automatic and applies only compatible defaults", () => {
  const actual = materializedRequest(provider, { model: "inworld-tts-2", text: "Hello", voice: "custom", output: { format: "pcm" } });
  assert.deepEqual(actual, { model: "inworld-tts-2", text: "Hello", voice: "custom", output: { format: "pcm", sampleRateHz: 48000 },
    speed: 1, textNormalization: "auto", timestampDelivery: "trailing", audioEnhancement: false, deliveryMode: "balanced" });
  validateRequest(actual);
});
