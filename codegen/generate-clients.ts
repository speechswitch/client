import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderAwsClient, type AwsServiceModel } from "./aws-client.ts";
import { parseCatalog } from "./catalog.ts";
import { deepgramContracts, renderDeepgramClient } from "./deepgram-client.ts";
import {
  elevenLabsContracts,
  extractElevenLabsAsyncApi,
  renderElevenLabsClient,
} from "./elevenlabs-client.ts";
import { fishContracts, renderFishClient } from "./fish-client.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = parseCatalog(YAML.parse(await readFile(path.join(root, "schemas/sources.yaml"), "utf8")));
const source = catalog.sources.find(({ provider, name }) => provider === "amazon" && name === "polly");
if (!source || source.format !== "botocore-service-model") throw new TypeError("Missing amazon-polly Botocore service model source");
const sourceFile = path.join(root, source.path);
const sourceText = await readFile(sourceFile, "utf8");
const hash = createHash("sha256").update(sourceText).digest("hex");
if (hash !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
const model = JSON.parse(sourceText) as AwsServiceModel;
const outputFile = path.join(root, "sdk/generated/clients/amazon-polly.ts");
const output = renderAwsClient(model, ["SynthesizeSpeech", "StartSpeechSynthesisStream"], source.url);

if (process.argv.includes("--check")) {
  const current = await readFile(outputFile, "utf8").catch(() => "");
  if (current !== output) {
    console.error(`Generated client is stale: ${path.relative(root, outputFile)}. Run bun run generate:clients.`);
    process.exit(1);
  }
} else {
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, output);
  console.log("Generated Amazon Polly client");
}
const deepgramOpenapi = catalog.sources.find(({ provider, name }) => provider === "deepgram" && name === "api");
const deepgramAsyncapi = catalog.sources.find(({ provider, name }) => provider === "deepgram" && name === "streaming");
if (deepgramOpenapi && deepgramAsyncapi) {
  const inputs = await Promise.all([deepgramOpenapi, deepgramAsyncapi].map(async (source) => {
    const contents = await readFile(path.join(root, source.path), "utf8");
    const actual = createHash("sha256").update(contents).digest("hex");
    if (actual !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
    return YAML.parse(contents) as unknown;
  }));
  const deepgramOutputFile = path.join(root, "sdk/generated/clients/deepgram.ts");
  const generated = renderDeepgramClient(
    deepgramContracts(inputs[0], inputs[1]),
    [deepgramOpenapi.url, deepgramAsyncapi.url],
  );
  if (process.argv.includes("--check")) {
    const current = await readFile(deepgramOutputFile, "utf8").catch(() => "");
    if (current !== generated) {
      console.error("Generated client is stale: sdk/generated/clients/deepgram.ts. Run bun run generate:clients.");
      process.exit(1);
    }
  } else {
    await writeFile(deepgramOutputFile, generated);
    console.log("Generated Deepgram client");
  }
}

const elevenLabsOpenapi = catalog.sources.find(({ provider, name }) => provider === "elevenlabs" && name === "api");
const elevenLabsTts = catalog.sources.find(({ provider, name }) => provider === "elevenlabs" && name === "tts-streaming");
const elevenLabsDialogue = catalog.sources.find(({ provider, name }) => provider === "elevenlabs" && name === "dialogue-streaming");
if (elevenLabsOpenapi && elevenLabsTts && elevenLabsDialogue) {
  const sourceTexts = await Promise.all([elevenLabsOpenapi, elevenLabsTts, elevenLabsDialogue].map(async (source) => {
    const contents = await readFile(path.join(root, source.path), "utf8");
    const actual = createHash("sha256").update(contents).digest("hex");
    if (actual !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
    return contents;
  }));
  const contracts = elevenLabsContracts(
    JSON.parse(sourceTexts[0]!) as unknown,
    YAML.parse(extractElevenLabsAsyncApi(sourceTexts[1]!, "/v1/text-to-speech/{voice_id}/stream-input")) as unknown,
    YAML.parse(extractElevenLabsAsyncApi(sourceTexts[2]!, "/v1/text-to-dialogue/stream-input")) as unknown,
  );
  const elevenLabsOutputFile = path.join(root, "sdk/generated/clients/elevenlabs.ts");
  const generated = renderElevenLabsClient(contracts, [elevenLabsOpenapi.url, elevenLabsTts.url, elevenLabsDialogue.url]);
  if (process.argv.includes("--check")) {
    const current = await readFile(elevenLabsOutputFile, "utf8").catch(() => "");
    if (current !== generated) {
      console.error("Generated client is stale: sdk/generated/clients/elevenlabs.ts. Run bun run generate:clients.");
      process.exit(1);
    }
  } else {
    await writeFile(elevenLabsOutputFile, generated);
    console.log("Generated ElevenLabs client");
  }
}

const fishSources = catalog.sources.filter(({ provider }) => provider === "fish");
for (const source of fishSources) {
  const contents = await readFile(path.join(root, source.path), "utf8");
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
}
const fishOpenapi = fishSources.find(({ name }) => name === "api");
if (fishOpenapi) {
  const sourceText = await readFile(path.join(root, fishOpenapi.path), "utf8");
  const fishOutputFile = path.join(root, "sdk/generated/clients/fish.ts");
  const generated = renderFishClient(fishContracts(JSON.parse(sourceText) as unknown), fishOpenapi.url);
  if (process.argv.includes("--check")) {
    const current = await readFile(fishOutputFile, "utf8").catch(() => "");
    if (current !== generated) {
      console.error("Generated client is stale: sdk/generated/clients/fish.ts. Run bun run generate:clients.");
      process.exit(1);
    }
  } else {
    await writeFile(fishOutputFile, generated);
    console.log("Generated Fish Audio client");
  }
}
