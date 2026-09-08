import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/vocu.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "vocu")!;
test("Vocu playground materializes auto language without inventing a model selector", () => {
  const request = materializedRequest(provider, { voice: "owned", text: "Hello", output: { format: "mp3" } });
  assert.deepEqual(request, { voice: "owned", text: "Hello", output: { format: "mp3" }, voiceStyle: "default", language: "auto", deliveryMode: "balanced", vividExpression: false, speed: 1, randomSeed: -1, latencyOptimization: "none" });
  validateRequest(request);
});
test("Vocu playground leaves inline binding omissions intact for native inheritance", () => {
  const input = { text: "[A] Hello", textSplitter: { placeholders: [{ marker: "[A]", voice: "owned" }], lookup: [{ tags: ["angry"], emotionSource: "text" }] } };
  const request = materializedRequest(provider, input);
  assert.deepEqual(request, input); validateRequest(request);
});
test("Vocu graph retains seven input/markup/subtitle variants and generated batch bounds", () => {
  const request = spec.tts.providers.find(value => value.id === "vocu")!.request;
  assert.equal(request.kind, "union"); if (request.kind !== "union") throw new Error("Expected variants");
  assert.equal(request.anyOf.length, 7);
  const batch = request.anyOf.find(type => type.kind === "object" && type.fields.some(field => field.name === "segments"));
  assert.equal(batch?.kind, "object"); if (batch?.kind !== "object") throw new Error("Expected batch");
  assert.deepEqual(batch.fields.find(field => field.name === "segments")?.constraints, { minItems: 1 });
});
