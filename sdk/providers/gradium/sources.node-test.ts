import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const api = JSON.parse(readFileSync(new URL("../../../schemas/sources/gradium/00-openapi.json", import.meta.url), "utf8"));
test("Gradium's raw contract omits tuning/model fields and response schemas, so cannot drive a complete wire client", () => {
  const post = api.paths["/post/speech/tts"].post;
  assert.deepEqual(Object.keys(post.requestBody.content["application/json"].schema.properties).sort(), ["only_audio", "output_format", "text", "voice_id"]);
  assert.deepEqual(post.responses, {
    200: { description: "Audio data returned successfully" },
    500: { description: "Pre-stream error. Body is plain text. Upstream errors (authentication, worker rejections) are formatted as `error from server <code>: <reason>`; proxy-level rejections (e.g. malformed request body) come back as raw error strings." },
  });
});

test("Gradium cataloged routes include only one HTTP synthesis operation, not the stale duplicate from the issue", () => {
  assert.deepEqual(Object.entries(api.paths).filter(([path]) => path.endsWith("tts")).map(([path, methods]) => [path, Object.keys(methods as object)]),
    [["/speech/tts", ["get"]], ["/post/speech/tts", ["post"]]]);
});
