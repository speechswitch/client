import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { inworldContracts, renderInworldOpenApi } from "./inworld-client.ts";

test("extracts current HTTP and WebSocket contracts from Inworld Flight pages", async () => {
  const directory = new URL("../schemas/sources/inworld/", import.meta.url);
  const files = await Promise.all([
    "00-embedded-json-schema.html",
    "01-embedded-json-schema.html",
    "05-websocket.html",
    "02-llms-txt.txt",
    "03-markdown.md",
    "04-markdown.md",
  ].map((name) => readFile(new URL(name, directory), "utf8")));
  const contract = inworldContracts(
    files[0]!, files[1]!, files[2]!, files[3]!, files[4]!, files[5]!,
  );
  expect(contract.synchronousPath).toBe("/tts/v1/voice");
  expect(contract.streamingPath).toBe("/tts/v1/voice:stream");
  expect(contract.webSocketPath).toBe("/tts/v1/voice:streamBidirectional");
  expect(contract.models).toEqual([
    "inworld-tts-2",
    "inworld-tts-1.5-max",
    "inworld-tts-1.5-mini",
  ]);
  expect(contract.httpAudioEncodings).toContain("FLAC");
  expect(contract.webSocketAudioEncodings).not.toContain("FLAC");
  const openapi = JSON.parse(renderInworldOpenApi(files[0]!, files[1]!));
  expect(Object.keys(openapi.paths)).toEqual(["/tts/v1/voice", "/tts/v1/voice:stream"]);
  expect(openapi.paths["/tts/v1/voice:stream"].post.requestBody.content["application/json"]
    .schema.properties.timestampTransportStrategy.enum).toEqual([
      "TIMESTAMP_TRANSPORT_STRATEGY_UNSPECIFIED", "SYNC", "ASYNC",
    ]);
});
