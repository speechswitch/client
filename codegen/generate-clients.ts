import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderAwsClient, type AwsServiceModel } from "./aws-client.ts";
import { parseCatalog } from "./catalog.ts";
import { renderCambClient } from "./camb-client.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = parseCatalog(YAML.parse(await readFile(path.join(root, "schemas/sources.yaml"), "utf8")));
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
