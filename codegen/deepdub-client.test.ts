import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { deepdubContract } from "./deepdub-client.ts";

test("selects Deepdub's streaming audio TTS contract", async () => {
  const directory = new URL("../schemas/sources/deepdub/", import.meta.url);
  const [api, documentation] = await Promise.all([readFile(new URL("00-openapi.json", directory), "utf8"), readFile(new URL("01-llms-txt.txt", directory), "utf8")]);
  expect(deepdubContract(JSON.parse(api), documentation)).toEqual({ baseUrl: "https://restapi.deepdub.ai/api/v1" });
});
