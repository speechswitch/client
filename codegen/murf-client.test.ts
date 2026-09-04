import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { murfContracts, renderMurfClient } from "./murf-client.ts";

test("selects Murf HTTP and WebSocket speech contracts", async () => {
  const directory = new URL("../schemas/sources/murf/", import.meta.url);
  const [openapi, asyncapi] = await Promise.all([
    readFile(new URL("00-openapi.json", directory), "utf8"),
    readFile(new URL("01-asyncapi.json", directory), "utf8"),
  ]);
  const contract = murfContracts(JSON.parse(openapi), JSON.parse(asyncapi));
  expect(contract).toEqual({
    generatePath: "/v1/speech/generate",
    streamPath: "/v1/speech/stream",
    voicesPath: "/v1/speech/voices",
    webSocketUrl: "wss://global.api.murf.ai/v1/speech/stream-input",
  });
  expect(renderMurfClient(contract, ["one", "two"])).toContain('request("/v1/speech/stream"');
});
