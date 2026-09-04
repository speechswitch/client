import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { cambContract } from "./camb-client.ts";

test("selects CAMB.AI streaming and live TTS contracts", async () => {
  const [api, live, docs] = await Promise.all([readFile("schemas/sources/camb/00-openapi.json", "utf8"), readFile("schemas/sources/camb/01-asyncapi.json", "utf8"), readFile("schemas/sources/camb/02-llms-txt.txt", "utf8")]);
  expect(cambContract(JSON.parse(api), JSON.parse(live), docs)).toMatchObject({ baseUrl: "https://client.camb.ai/apis", webSocketUrl: "wss://client.camb.ai/apis/live-tts/ws", liveFormats: ["mp3", "wav", "flac", "aac"] });
});
