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
import { googleContracts, renderGoogleClient } from "./google-client.ts";
import { gradiumContracts, renderGradiumClient } from "./gradium-client.ts";
import { humeContracts, renderHumeClient } from "./hume-client.ts";
import { inworldContracts, renderInworldClient, renderInworldOpenApi } from "./inworld-client.ts";

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

const googleV1 = catalog.sources.find(({ provider, name }) => provider === "google" && name === "v1");
const googleBeta = catalog.sources.find(({ provider, name }) => provider === "google" && name === "v1beta1");
if (googleV1 && googleBeta) {
  const sourceTexts = await Promise.all([googleV1, googleBeta].map(async (source) => {
    const contents = await readFile(path.join(root, source.path), "utf8");
    const actual = createHash("sha256").update(contents).digest("hex");
    if (actual !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
    return contents;
  }));
  const googleOutputFile = path.join(root, "sdk/generated/clients/google.ts");
  const generated = renderGoogleClient(
    googleContracts(JSON.parse(sourceTexts[0]!) as unknown, JSON.parse(sourceTexts[1]!) as unknown),
    [googleV1.url, googleBeta.url],
  );
  if (process.argv.includes("--check")) {
    const current = await readFile(googleOutputFile, "utf8").catch(() => "");
    if (current !== generated) {
      console.error("Generated client is stale: sdk/generated/clients/google.ts. Run bun run generate:clients.");
      process.exit(1);
    }
  } else {
    await writeFile(googleOutputFile, generated);
    console.log("Generated Google Cloud TTS client");
  }
}

const gradiumSources = catalog.sources.filter(({ provider }) => provider === "gradium");
for (const source of gradiumSources) {
  const contents = await readFile(path.join(root, source.path), "utf8");
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
}
const gradiumOpenapi = gradiumSources.find(({ name }) => name === "api");
if (gradiumOpenapi) {
  const sourceText = await readFile(path.join(root, gradiumOpenapi.path), "utf8");
  const gradiumOutputFile = path.join(root, "sdk/generated/clients/gradium.ts");
  const generated = renderGradiumClient(gradiumContracts(JSON.parse(sourceText) as unknown), gradiumOpenapi.url);
  if (process.argv.includes("--check")) {
    const current = await readFile(gradiumOutputFile, "utf8").catch(() => "");
    if (current !== generated) {
      console.error("Generated client is stale: sdk/generated/clients/gradium.ts. Run bun run generate:clients.");
      process.exit(1);
    }
  } else {
    await writeFile(gradiumOutputFile, generated);
    console.log("Generated Gradium client");
  }
}

const humeSources = catalog.sources.filter(({ provider }) => provider === "hume");
const humeTexts = await Promise.all(humeSources.map(async (source) => {
  const contents = await readFile(path.join(root, source.path), "utf8");
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
  return contents;
}));
const humeFern = humeSources.findIndex(({ name }) => name === "api");
const humeOpenapi = humeSources.findIndex(({ name }) => name === "voices");
const humeAsyncapi = humeSources.findIndex(({ name }) => name === "streaming");
if (humeFern !== -1 && humeOpenapi !== -1 && humeAsyncapi !== -1) {
  const humeOutputFile = path.join(root, "sdk/generated/clients/hume.ts");
  const generated = renderHumeClient(humeContracts(
    JSON.parse(humeTexts[humeFern]!) as unknown,
    JSON.parse(humeTexts[humeOpenapi]!) as unknown,
    JSON.parse(humeTexts[humeAsyncapi]!) as unknown,
  ), humeSources.map(({ url }) => url));
  if (process.argv.includes("--check")) {
    const current = await readFile(humeOutputFile, "utf8").catch(() => "");
    if (current !== generated) {
      console.error("Generated client is stale: sdk/generated/clients/hume.ts. Run bun run generate:clients.");
      process.exit(1);
    }
  } else {
    await writeFile(humeOutputFile, generated);
    console.log("Generated Hume client");
  }
}

const inworldSources = catalog.sources.filter(({ provider }) => provider === "inworld");
const inworldTexts = await Promise.all(inworldSources.map(async (source) => {
  const contents = await readFile(path.join(root, source.path), "utf8");
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
  return contents;
}));
const inworldSource = (name: string): string | undefined => {
  const index = inworldSources.findIndex((source) => source.name === name);
  return index === -1 ? undefined : inworldTexts[index];
};
const inworldInputs = [
  inworldSource("synchronous"),
  inworldSource("streaming"),
  inworldSource("websocket"),
  inworldSource("documentation"),
  inworldSource("synchronous-markdown"),
  inworldSource("websocket-markdown"),
] as const;
const [inworldSynchronous, inworldStreaming, inworldWebSocket, inworldDocumentation,
  inworldSynchronousMarkdown, inworldWebSocketMarkdown] = inworldInputs;
if (inworldSynchronous !== undefined && inworldStreaming !== undefined && inworldWebSocket !== undefined
  && inworldDocumentation !== undefined && inworldSynchronousMarkdown !== undefined
  && inworldWebSocketMarkdown !== undefined) {
  const inworldOutputFile = path.join(root, "sdk/generated/clients/inworld.ts");
  const inworldOpenApiFile = path.join(root, "schemas/generated/inworld.openapi.json");
  const derivedOpenApi = renderInworldOpenApi(inworldSynchronous, inworldStreaming);
  const generated = renderInworldClient(
    inworldContracts(
      inworldSynchronous,
      inworldStreaming,
      inworldWebSocket,
      inworldDocumentation,
      inworldSynchronousMarkdown,
      inworldWebSocketMarkdown,
    ),
    inworldSources.map(({ url }) => url),
  );
  if (process.argv.includes("--check")) {
    const current = await readFile(inworldOutputFile, "utf8").catch(() => "");
    const currentOpenApi = await readFile(inworldOpenApiFile, "utf8").catch(() => "");
    if (current !== generated || currentOpenApi !== derivedOpenApi) {
      console.error("Generated client is stale: sdk/generated/clients/inworld.ts. Run bun run generate:clients.");
      process.exit(1);
    }
  } else {
    await mkdir(path.dirname(inworldOpenApiFile), { recursive: true });
    await writeFile(inworldOpenApiFile, derivedOpenApi);
    await writeFile(inworldOutputFile, generated);
    console.log("Generated Inworld client");
  }
}
