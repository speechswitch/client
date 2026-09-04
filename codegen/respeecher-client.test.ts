import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderRespeecherClient, respeecherContracts } from "./respeecher-client.ts";

test("selects Respeecher byte, JSONL, and cancellation-aware WebSocket contracts", async () => {
  const files = await Promise.all(Array.from({ length: 8 }, (_, index) => readFile(new URL(`../schemas/sources/respeecher/0${index}-${["openapi.json", "asyncapi.json", "llms-txt.txt", "bytes.md", "sse.md", "websocket.md", "websocket-guide.md", "quickstart.md"][index]}`, import.meta.url), "utf8")));
  const contract = respeecherContracts(JSON.parse(files[0]!), JSON.parse(files[1]!), files.slice(2));
  expect(contract.bytesPath).toBe("/tts/bytes");
  expect(contract.webSocketPath).toBe("/tts/websocket");
  expect(contract.encodings).toEqual(["pcm_f32le", "pcm_s16le", "pcm_mulaw"]);
  expect(renderRespeecherClient(contract, ["source"])).toContain("CancellationRequest");
});
