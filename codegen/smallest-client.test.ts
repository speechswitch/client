import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { smallestContracts } from "./smallest-client.ts";

describe("Smallest.ai client generation", () => {
  test("extracts the current model-agnostic HTTP and WebSocket contracts", async () => {
    const [http, websocket, docs] = await Promise.all([
      readFile("schemas/sources/smallest.ai/00-openapi.yaml", "utf8"),
      readFile("schemas/sources/smallest.ai/01-asyncapi.yaml", "utf8"),
      readFile("schemas/sources/smallest.ai/02-llms-txt.txt", "utf8"),
    ]);
    expect(smallestContracts(YAML.parse(http), YAML.parse(websocket), docs)).toEqual({
      httpServer: "https://api.smallest.ai",
      syncPath: "/waves/v1/tts",
      livePath: "/waves/v1/tts/live",
      webSocketUrl: "wss://api.smallest.ai/waves/v1/tts/live",
      models: ["lightning_v3.1", "lightning_v3.1_pro"],
      languages: ["auto", "en", "hi", "mr", "kn", "ta", "bn", "gu", "te", "ml", "pa", "or", "es", "de", "fr", "it", "nl", "sv", "pt", "ru", "el", "fi", "no", "pl", "ar", "zh", "id", "ja", "ko", "ms", "tr", "vi"],
      formats: ["mp3", "pcm", "wav", "ulaw", "alaw"],
      sampleRates: [8000, 16000, 24000, 44100],
    });
  });
});
