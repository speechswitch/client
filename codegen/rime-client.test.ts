import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderRimeClient, rimeContracts } from "./rime-client.ts";

test("extracts Rime production HTTP and JSON WebSocket contracts", async () => {
  const source = (index: number, extension: string) => readFile(new URL(`../schemas/sources/rime/${String(index).padStart(2, "0")}-${extension}`, import.meta.url), "utf8");
  const html = await Promise.all([0, 2, 3, 5, 6, 9].map((index) => source(index, "embedded-json-schema.html")));
  const contract = rimeContracts(html, await source(16, "markdown.md"), await source(17, "markdown.md"));
  expect(contract).toEqual({ httpServer: "https://users.rime.ai", httpPath: "/v1/rime-tts", webSocketServer: "wss://users-ws.rime.ai", modernPath: "/ws3", legacyPath: "/ws2" });
  expect(renderRimeClient(contract, ["source"])).toContain('readonly operation: "clear" | "flush" | "eos"');
});
