import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { cartesiaContract } from "./cartesia-client.ts";

test("extracts Cartesia HTTP and WebSocket contracts from React Flight", async () => {
  const directory = new URL("../schemas/sources/cartesia/", import.meta.url);
  const names = ["00-embedded-json-schema.html", "01-embedded-json-schema.html", "02-embedded-json-schema.html", "04-markdown.md", "05-markdown.md", "06-markdown.md", "07-markdown.md", "08-contexts.md", "09-flushing.md", "10-buffering.md"] as const;
  const values = await Promise.all(names.map((name) => readFile(new URL(name, directory), "utf8")));
  const contract = cartesiaContract(values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!, values[6]!, values[7]!, values[8]!, values[9]!);
  expect(contract).toMatchObject({
    baseUrl: "https://api.cartesia.ai",
    webSocketUrl: "wss://api.cartesia.ai/tts/websocket",
    version: "2026-08-14",
  });
  expect(contract.models).toContain("sonic-3.5");
  expect(contract.sampleRates).toEqual([8000, 16000, 22050, 24000, 44100, 48000]);
});
