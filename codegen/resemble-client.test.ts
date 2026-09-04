import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resembleContracts, renderResembleClient } from "./resemble-client.ts";

test("extracts all three deployed Resemble Chatterbox contracts", async () => {
  const values = await Promise.all([0, 1, 2].map(async (index) => JSON.parse(await readFile(
    new URL(`../schemas/sources/resemble/0${index}-gradio-schema.json`, import.meta.url), "utf8",
  )) as unknown));
  const contracts = resembleContracts(values);
  expect(contracts.map(({ model, apiName }) => ({ model, apiName }))).toEqual([
    { model: "chatterbox", apiName: "generate_tts_audio" },
    { model: "chatterbox-multilingual", apiName: "generate_tts_audio" },
    { model: "chatterbox-turbo", apiName: "generate" },
  ]);
  expect(contracts[1]?.languages).toHaveLength(23);
  expect(renderResembleClient(contracts, ["source"])).toContain("/gradio_api/run/");
});
