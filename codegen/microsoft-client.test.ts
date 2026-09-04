import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { microsoftContracts, renderMicrosoftClient } from "./microsoft-client.ts";

test("keeps Azure management and synthesis contracts separate", async () => {
  const directory = new URL("../schemas/sources/microsoft/", import.meta.url);
  const [main, routes, models, client, swagger, rest, hd, mai] = await Promise.all([
    "00-main.tsp", "01-routes.tsp", "02-models.tsp", "03-client.tsp", "04-swagger.json",
    "05-rest.md", "06-high-definition-voices.md", "07-mai-voices.md",
  ].map((name) => readFile(new URL(name, directory), "utf8")));
  const contract = microsoftContracts(JSON.parse(swagger!), rest!, [main!, routes!, models!, client!], hd!, mai!);
  expect(contract.synthesisPath).toBe("/cognitiveservices/v1");
  expect(contract.resourceVoiceListPath).toBe("/tts/cognitiveservices/voices/list");
  expect(contract.outputFormats).toContain("audio-24khz-160kbitrate-mono-mp3");
  expect(renderMicrosoftClient(contract, ["source"])).toContain('export const synthesisPath = "/cognitiveservices/v1"');
});
