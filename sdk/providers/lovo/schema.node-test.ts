import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest, objectFields } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/lovo.ts";

const provider = providerSchemasFromSpeechSpec(extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname)).find(value => value.id === "lovo")!;
test("LOVO form exposes actual native fields without fabricated model, format or streaming controls", () => {
  assert.deepEqual(objectFields(provider.request, { text: "Hello", voice: "speaker" }).map(field => field.name), ["speed", "text", "voice", "voiceStyle"]);
  assert.equal(provider.streamingText, undefined);
  const actual = materializedRequest(provider, { text: "Hello", voice: "speaker", voiceStyle: "style" });
  assert.deepEqual(actual, { text: "Hello", voice: "speaker", voiceStyle: "style", speed: 1 }); validateRequest(actual);
});
