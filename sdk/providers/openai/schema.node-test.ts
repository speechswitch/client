import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import { providerSchemasFromSpeechSpec } from "../../../playground/src/lib/provider-schemas.ts";
import { materializedRequest } from "../../../playground/src/lib/provider-request.ts";
import { validateRequest } from "../../generated/validators/openai.ts";

const spec = extractRepositorySpeechSpec(new URL("../../../", import.meta.url).pathname);
const provider = providerSchemasFromSpeechSpec(spec).find(value => value.id === "openai")!;
test("OpenAI playground defaults retain legacy model and native PCM without adding mini fields", () => {
  const request = materializedRequest(provider, { text: "Hello", voice: "alloy", model: "tts-1", output: { format: "pcm" } });
  assert.deepEqual(request, { text: "Hello", voice: "alloy", model: "tts-1", speed: 1, output: { format: "pcm", sampleRateHz: 24000, sampleEncoding: "signed_integer_16", byteOrder: "little_endian", channelCount: 1 } });
  validateRequest(request);
});
test("OpenAI playground materializes mini catalog and custom voice branches independently", () => {
  const catalog = materializedRequest(provider, { text: "Hello", voice: "cedar", model: "gpt-4o-mini-tts", instructions: "Whisper" });
  assert.deepEqual(catalog, { text: "Hello", voice: "cedar", model: "gpt-4o-mini-tts", instructions: "Whisper", speed: 1, includeUsage: false });
  validateRequest(catalog);
  const custom = materializedRequest(provider, { text: "Hello", voice: "saved", voiceSource: "custom", model: "gpt-4o-mini-tts-2025-12-15", includeUsage: true });
  assert.deepEqual(custom, { text: "Hello", voice: "saved", voiceSource: "custom", model: "gpt-4o-mini-tts-2025-12-15", speed: 1, includeUsage: true });
  validateRequest(custom);
});
