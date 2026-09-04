import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { lovoContracts, renderLovoClient } from "./lovo-client.ts";

test("selects LOVO's synchronous TTS, polling, and speaker operations", async () => {
  const source = await readFile(new URL("../schemas/sources/lovo/00-openapi.json", import.meta.url), "utf8");
  const contract = lovoContracts(JSON.parse(source) as unknown);
  expect(contract).toEqual({
    synthesizePath: "/api/v1/tts/sync",
    jobPath: "/api/v1/tts/{jobId}",
    speakersPath: "/api/v1/speakers",
  });
  const generated = renderLovoClient(contract, "source");
  expect(generated).toContain('requestJson<SpeechJob>("/api/v1/tts/sync"');
  expect(generated).toContain('"/api/v1/tts/{jobId}".replace');
  expect(generated).toContain('new URL("/api/v1/speakers"');
});
