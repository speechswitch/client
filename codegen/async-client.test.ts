import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { asyncContract } from "./async-client.ts";

describe("Async client generation", () => {
  test("selects the complete HTTP and handwritten WebSocket contracts", async () => {
    const [api, socket, models] = await Promise.all([
      readFile("schemas/sources/async/00-openapi.json", "utf8"),
      readFile("schemas/sources/async/02-websocket.md", "utf8"),
      readFile("schemas/sources/async/03-models.md", "utf8"),
    ]);
    expect(asyncContract(JSON.parse(api), socket, models)).toMatchObject({
      server: "https://api.async.com",
      webSocketServer: "wss://api.async.com/text_to_speech/websocket/ws",
      models: ["async_pro_v1.0", "async_flash_v1.5", "async_flash_v1.0"],
    });
  });
});
