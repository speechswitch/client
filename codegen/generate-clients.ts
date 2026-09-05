import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderAwsClient, type AwsServiceModel } from "./aws-client.ts";
import { parseCatalog } from "./catalog.ts";
import { renderCambClient } from "./camb-client.ts";
import { renderGoogleDiscovery } from "./google-discovery.ts";
import { renderGoogleProtobuf } from "./google-protobuf.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = parseCatalog(YAML.parse(await readFile(path.join(root, "schemas/sources.yaml"), "utf8")));
const googleSources = catalog.sources.filter(source => source.provider === "google");
if (googleSources.length) {
  const inputs = await Promise.all(googleSources.map(async source => {
    const text = await readFile(path.join(root, source.path), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
    return { ...source, text };
  }));
  const stable = inputs.find(source => source.name === "discovery-v1");
  const beta = inputs.find(source => source.name === "discovery-v1beta1");
  const proto = inputs.find(source => source.name === "cloud-tts-v1");
  if (!stable || !beta || !proto) throw new TypeError("Incomplete Google source catalog");
  const outputs = new Map([
    ["google-rest.ts", renderGoogleDiscovery(JSON.parse(stable.text), stable.url)],
    ["google-rest-beta.ts", renderGoogleDiscovery(JSON.parse(beta.text), beta.url)],
    ["google-grpc.ts", renderGoogleProtobuf([
      { name: "google/cloud/texttospeech/v1/cloud_tts.proto", text: proto.text },
      ...inputs.filter(source => source.path.includes("/imports/")).map(source => ({ name: source.path.split("/imports/")[1]!, text: source.text })),
    ], "google.cloud.texttospeech.v1.TextToSpeech", "StreamingSynthesize")],
  ]);
  for (const [name, generated] of outputs) {
    const file = path.join(root, "sdk/generated/clients", name);
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== generated) throw new TypeError(`Generated Google client is stale: ${name}`);
    } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, generated); }
  }
}
const cambSources = ["api", "live-tts"].map(name => catalog.sources.find(source => source.provider === "camb" && source.name === name));
if (cambSources.some(Boolean)) {
  const inputs = await Promise.all(cambSources.map(async source => {
    if (!source) throw new TypeError("Incomplete CAMB source catalog");
    const contents = await readFile(path.join(root, source.path), "utf8");
    if (createHash("sha256").update(contents).digest("hex") !== source.sha256) throw new TypeError(`Source hash changed: ${source.path}`);
    return JSON.parse(contents) as unknown;
  }));
  const outputs = renderCambClient(inputs[0], inputs[1], cambSources.map(source => source!.url));
  for (const [relative, generated] of [["sdk/generated/clients/camb.ts", outputs.client], ["schemas/generated/camb-languages.ts", outputs.languages]]) {
    const file = path.join(root, relative!);
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== generated) throw new TypeError(`Generated file is stale: ${relative}`);
    } else {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, generated!);
    }
  }
}
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
