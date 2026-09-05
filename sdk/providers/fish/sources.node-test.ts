import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const api = JSON.parse(readFileSync(new URL("../../../schemas/sources/fish/00-openapi.json", import.meta.url), "utf8"));

test("Fish OpenAPI does not describe successful byte-native TTS output", () => {
  assert.deepEqual(api.paths["/v1/tts"].post.responses["200"], {
    description: "Request fulfilled, document follows",
    headers: { "Transfer-Encoding": { schema: { type: "string" }, description: "chunked" } },
  });
});

test("Fish speed bounds and model-specific loudness behavior exist only in prose", () => {
  assert.deepEqual(api.components.schemas.ProsodyControl.properties.speed, {
    default: 1, description: "Speaking rate multiplier. Valid range: 0.5 to 2.0. 1.0 = normal speed, 0.5 = half speed, 2.0 = double speed. Useful for adjusting pacing without regenerating audio.", title: "Speed", type: "number",
  });
  assert.deepEqual(api.components.schemas.ProsodyControl.properties.normalize_loudness, {
    default: true, description: "Normalize output loudness for more consistent perceived volume. Applies to the S2 family (`s2-pro`, `s2.1-pro`, `s2.1-pro-free`); on `s1` it is accepted but has no effect.", title: "Normalize Loudness", type: "boolean",
  });
});

test("Fish describes timing as text segments without promising word granularity", () => {
  assert.deepEqual(api.components.schemas.TTSTimestampSegment, {
    properties: {
      text: { description: "Text segment covered by this timing entry.", title: "Text", type: "string" },
      start: { description: "Segment start time in seconds.", title: "Start", type: "number" },
      end: { description: "Segment end time in seconds.", title: "End", type: "number" },
    }, required: ["text", "start", "end"], title: "TTSTimestampSegment", type: "object",
  });
});
