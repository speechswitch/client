import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  kugelAudioContracts,
  kugelAudioDocumentation,
  renderKugelAudioClient,
} from "./kugelaudio-client.ts";

test("selects the native KugelAudio endpoints", async () => {
  const source = await readFile(new URL("../schemas/sources/kugelaudio/00-openapi.json", import.meta.url), "utf8");
  const contract = kugelAudioContracts(JSON.parse(source) as unknown);
  expect(contract).toEqual({
    synthesizePath: "/v1/tts/generate",
    voicesPath: "/v1/voices",
    voicePath: "/v1/voices/{voice_id}",
    modelsPath: "/v1/models",
  });
  const generated = renderKugelAudioClient(contract, "source");
  expect(generated).toContain('request("/v1/tts/generate"');
  expect(generated).not.toContain("/11labs/");
});

test("validates the handwritten WebSocket protocol against first-party references", async () => {
  const directory = new URL("../schemas/sources/kugelaudio/", import.meta.url);
  const files = await Promise.all([
    "02-generate.md", "03-stream-input.md", "04-audio-formats.md", "05-word-timestamps.md",
    "06-barge-in.md", "07-models.md",
  ].map((name) => readFile(new URL(name, directory), "utf8")));
  expect(kugelAudioDocumentation(files[0]!, files[1]!, files[2]!, files[3]!, files[4]!, files[5]!)).toEqual({
    webSocketUrl: "wss://api.kugelaudio.com/ws/tts/stream?api_key=YOUR_API_KEY",
    models: ["kugel-3", "kugel-2.5", "kugel-2-turbo", "kugel-2", "kugel-1", "kugel-1-turbo"],
    outputFormats: ["pcm_8000", "pcm_16000", "pcm_22050", "pcm_24000", "ulaw_8000", "alaw_8000"],
  });
});
