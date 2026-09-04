import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { miniMaxContracts, renderMiniMaxClient } from "./minimax-client.ts";

test("selects MiniMax's focused streaming T2A operation", async () => {
  const source = await readFile(new URL("../schemas/sources/minimax/00-openapi.json", import.meta.url), "utf8");
  const contract = miniMaxContracts(JSON.parse(source) as unknown);
  expect(contract).toEqual({ synthesizePath: "/v1/t2a_v2" });
  expect(renderMiniMaxClient(contract, "source")).toContain('new URL("/v1/t2a_v2"');
});
