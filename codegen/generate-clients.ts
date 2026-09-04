import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderAwsClient, type AwsServiceModel } from "./aws-client.ts";
import { parseCatalog } from "./catalog.ts";
import { renderXaiStreamingClient } from "./xai-streaming-client.ts";

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

const xaiSources = catalog.sources.filter(({ provider }) => provider === "xai");
for (const source of xaiSources) {
  const text = await readFile(path.join(root, source.path), "utf8");
  const actual = createHash("sha256").update(text).digest("hex");
  if (actual !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
}
const xaiStreaming = xaiSources.find(({ name }) => name === "tts-streaming");
if (xaiStreaming) {
  const xaiOutputFile = path.join(root, "sdk/generated/clients/xai-streaming.ts");
  const sourceText = await readFile(path.join(root, xaiStreaming.path), "utf8");
  const generated = renderXaiStreamingClient(JSON.parse(sourceText) as unknown, xaiStreaming.url);
  if (process.argv.includes("--check")) {
    const current = await readFile(xaiOutputFile, "utf8").catch(() => "");
    if (generated !== current) {
      console.error("Generated client is stale: sdk/generated/clients/xai-streaming.ts. Run bun run generate:clients.");
      process.exit(1);
    }
  } else {
    await writeFile(xaiOutputFile, generated);
    console.log("Generated xAI streaming client");
  }
}
