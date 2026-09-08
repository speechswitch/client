import { expect, test } from "bun:test";
import { audioData, decodeEvent, decodeJson, decodeUsage } from "./protocol.ts";

test("Mistral decodes base64 bytes without reinterpreting float32 PCM samples", () => {
  expect(audioData("AADAPwAAAMB/gP8=")).toEqual(Uint8Array.of(0, 0, 192, 63, 0, 0, 0, 192, 127, 128, 255));
  expect(decodeJson({ audio_data: "AP+A" })).toEqual(Uint8Array.of(0, 255, 128));
});
test.each(["!", "A", "AQ=", "AA==junk", "AA-_", "AA==\n", null, 1])("Mistral rejects invalid base64 %#", value => {
  let failure: unknown; try { audioData(value); } catch (error) { failure = error; }
  expect(failure).toEqual(new TypeError("Mistral returned invalid base64 audio"));
});
test("Mistral SSE discriminator can come from the event field or the data type", () => {
  expect(decodeEvent({ event: "speech.audio.delta", data: '{"audio_data":"AQI="}' })).toEqual({ event: "audio", audio: Uint8Array.of(1, 2) });
  expect(decodeEvent({ event: "message", data: '{"type":"speech.audio.done","usage":{"completion_tokens":null}}' })).toEqual({ event: "done", usage: { completionTokens: null } });
});
test("Mistral preserves current usage nullability, omissions and both prompt-detail fields", () => {
  expect(decodeUsage({ prompt_tokens: 0, completion_tokens: null, total_tokens: 1, prompt_audio_seconds: null, request_count: 1, num_cached_tokens: 0,
    prompt_tokens_details: { cached_tokens: 0, audio_tokens: 1, messages: [{ role: "user", total_tokens: null, truncated: false, usage_count: 0 }] },
    prompt_token_details: null, completion_tokens_details: { reasoning_tokens: 0 } })).toEqual({
    promptTokens: 0, completionTokens: null, totalTokens: 1, promptAudioSeconds: null, requestCount: 1, cachedTokens: 0,
    promptTokensDetails: { cachedTokens: 0, audioTokens: 1, messages: [{ role: "user", totalTokens: null, truncated: false, usageCount: 0 }] },
    promptTokenDetails: null, completionTokensDetails: { reasoningTokens: 0 },
  });
  expect(decodeUsage({})).toEqual({});
});
test.each([
  [{ event: "speech.audio.done", data: '{"type":"speech.audio.delta","audio_data":"AQI="}' }, "Mistral returned conflicting SSE event types"],
  [{ event: "unknown", data: "{}" }, "Mistral returned an unsupported speech event"],
  [{ event: "speech.audio.done", data: '{"usage":{"prompt_tokens":null}}' }, "Mistral returned invalid prompt_tokens"],
  [{ event: "speech.audio.done", data: "{}" }, "Mistral returned an invalid response object"],
] as const)("Mistral rejects malformed event %# exactly", (packet, message) => {
  let failure: unknown; try { decodeEvent(packet); } catch (error) { failure = error; }
  expect(failure).toEqual(new TypeError(message));
});
