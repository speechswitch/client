import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { openAiContracts, renderOpenAiClient } from "./openai-client.ts";

test("selects the current OpenAI raw-audio speech contract", async () => {
  const [openapi, markdown] = await Promise.all([
    readFile(new URL("../schemas/sources/openai/00-openapi.yaml", import.meta.url), "utf8"),
    readFile(new URL("../schemas/sources/openai/01-speech.md", import.meta.url), "utf8"),
  ]);
  const contract = openAiContracts(YAML.parse(openapi) as unknown, markdown);
  expect(contract).toEqual({
    baseUrl: "https://api.openai.com/v1",
    speechPath: "/audio/speech",
    models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts", "gpt-4o-mini-tts-2025-12-15"],
    formats: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
  });
  expect(renderOpenAiClient(contract, ["source"])).toContain('stream_format: "audio"');
});
