import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { mistralContracts, renderMistralClient } from "./mistral-client.ts";

test("selects Mistral speech streaming and custom voice operations", async () => {
  const source = await readFile(new URL("../schemas/sources/mistral/00-openapi.yaml", import.meta.url), "utf8");
  const contract = mistralContracts(YAML.parse(source) as unknown);
  expect(contract).toEqual({
    speechPath: "/v1/audio/speech",
    voicesPath: "/v1/audio/voices",
    voicePath: "/v1/audio/voices/{voice_id}",
    samplePath: "/v1/audio/voices/{voice_id}/sample",
  });
  expect(renderMistralClient(contract, "source")).toContain('request("/v1/audio/speech"');
});
