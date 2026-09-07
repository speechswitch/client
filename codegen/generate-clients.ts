import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderAwsClient, type AwsServiceModel } from "./aws-client.ts";
import { parseCatalog } from "./catalog.ts";
import { renderCambClient } from "./camb-client.ts";
import { renderGoogleDiscovery } from "./google-discovery.ts";
import { renderGoogleDiscoveryPython } from "./google-discovery-python.ts";
import { renderGoogleDiscoveryGo } from "./google-discovery-go.ts";
import { renderGoogleDiscoveryRust } from "./google-discovery-rust.ts";
import { renderGoogleProtobuf } from "./google-protobuf.ts";
import { renderGoogleProtobufPython } from "./google-protobuf-python.ts";
import { renderGoogleProtobufGo } from "./google-protobuf-go.ts";
import { renderGoogleProtobufRust } from "./google-protobuf-rust.ts";
import { renderHpackTables } from "./hpack-tables.ts";
import { renderLovoClients } from "./lovo-client.ts";
import { renderOpenaiClients } from "./openai-client.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = parseCatalog(YAML.parse(await readFile(path.join(root, "schemas/sources.yaml"), "utf8")));
const openai = catalog.sources.find(source => source.provider === "openai" && source.name === "speech-openapi");
if (openai) {
  const text = await readFile(path.join(root, openai.path), "utf8");
  if (createHash("sha256").update(text).digest("hex") !== openai.sha256) throw new TypeError(`Source hash changed: ${openai.path}`);
  const clients = renderOpenaiClients(YAML.parse(text), openai.url);
  for (const [target, output] of [["sdk/generated/clients/openai.ts", clients.typescript], ["sdks/python/speechswitch/clients/openai.py", clients.python]] as const) {
    const file = path.join(root, target);
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== output) throw new TypeError(`Generated OpenAI client is stale: ${target}`);
    } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, output); }
  }
}
const lovo = catalog.sources.find(source => source.provider === "lovo" && source.name === "openapi");
if (lovo) {
  const text = await readFile(path.join(root, lovo.path), "utf8");
  if (createHash("sha256").update(text).digest("hex") !== lovo.sha256) throw new TypeError(`Source hash changed: ${lovo.path}`);
  const clients = renderLovoClients(JSON.parse(text), lovo.url);
  for (const [target, output] of [["sdk/generated/clients/lovo.ts", clients.typescript], ["sdks/python/speechswitch/clients/lovo.py", clients.python], ["sdks/go/clients/lovo/client.go", clients.go], ["sdks/rust/src/clients/lovo.rs", clients.rust]]) {
    const file = path.join(root, target!);
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== output) throw new TypeError(`Generated LOVO client is stale: ${target}`);
    } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, output!); }
  }
}
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
  const betaProto = inputs.find(source => source.name === "cloud-tts-v1beta1");
  if (!stable || !beta || !proto || !betaProto) throw new TypeError("Incomplete Google source catalog");
  const hpack = inputs.find(source => source.name === "hpack-rfc7541");
  if (!hpack) throw new TypeError("Missing cataloged HPACK definition");
  const hpackFile = path.join(root, "sdks/python/speechswitch/hpack_tables.py");
  const hpackOutput = renderHpackTables(hpack.text);
  if (process.argv.includes("--check")) {
    if (await readFile(hpackFile, "utf8").catch(() => "") !== hpackOutput) throw new TypeError("Generated HPACK tables are stale");
  } else { await writeFile(hpackFile, hpackOutput); }
  const outputs = new Map([
    ["google-rest.ts", renderGoogleDiscovery(JSON.parse(stable.text), stable.url)],
    ["google-rest-beta.ts", renderGoogleDiscovery(JSON.parse(beta.text), beta.url)],
    ["google-grpc.ts", renderGoogleProtobuf([
      { name: "google/cloud/texttospeech/v1/cloud_tts.proto", text: proto.text },
      ...inputs.filter(source => source.path.includes("/imports/")).map(source => ({ name: source.path.split("/imports/")[1]!, text: source.text })),
    ], "google.cloud.texttospeech.v1.TextToSpeech", "StreamingSynthesize")],
    ["google-grpc-beta.ts", renderGoogleProtobuf([
      { name: "google/cloud/texttospeech/v1beta1/cloud_tts.proto", text: betaProto.text },
      ...inputs.filter(source => source.path.includes("/imports/")).map(source => ({ name: source.path.split("/imports/")[1]!, text: source.text })),
    ], "google.cloud.texttospeech.v1beta1.TextToSpeech", "StreamingSynthesize")],
  ]);
  for (const [name, generated] of outputs) {
    const file = path.join(root, "sdk/generated/clients", name);
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== generated) throw new TypeError(`Generated Google client is stale: ${name}`);
    } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, generated); }
  }
  for (const [version, source, filename] of [["v1", proto, "google_grpc.py"], ["v1beta1", betaProto, "google_grpc_beta.py"]] as const) {
    const generated = renderGoogleProtobufPython([
      { name: `google/cloud/texttospeech/${version}/cloud_tts.proto`, text: source.text },
      ...inputs.filter(source => source.path.includes("/imports/")).map(source => ({ name: source.path.split("/imports/")[1]!, text: source.text })),
    ], `google.cloud.texttospeech.${version}.TextToSpeech`, "StreamingSynthesize");
    const file = path.join(root, "sdks/python/speechswitch/clients", filename);
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== generated) throw new TypeError(`Generated Google client is stale: ${filename}`);
    } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, generated); }
  }
  for (const [source, filename] of [[stable, "google_rest.py"], [beta, "google_rest_beta.py"]] as const) {
    const generated = renderGoogleDiscoveryPython(JSON.parse(source.text), source.url);
    const file = path.join(root, "sdks/python/speechswitch/clients", filename);
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== generated) throw new TypeError(`Generated Google client is stale: ${filename}`);
    } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, generated); }
  }
  for (const [source, packageName] of [[stable, "google_rest"], [beta, "google_rest_beta"]] as const) {
    const generated = renderGoogleDiscoveryGo(JSON.parse(source.text), source.url, packageName);
    const file = path.join(root, "sdks/go/clients", packageName, "client.go");
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== generated) throw new TypeError(`Generated Google client is stale: ${packageName}`);
    } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, generated); }
  }
  for (const [version, source, packageName] of [["v1", proto, "google_grpc"], ["v1beta1", betaProto, "google_grpc_beta"]] as const) {
    const generated = renderGoogleProtobufGo([
      { name: `google/cloud/texttospeech/${version}/cloud_tts.proto`, text: source.text },
      ...inputs.filter(source => source.path.includes("/imports/")).map(source => ({ name: source.path.split("/imports/")[1]!, text: source.text })),
    ], `google.cloud.texttospeech.${version}.TextToSpeech`, "StreamingSynthesize", packageName);
    const file = path.join(root, "sdks/go/clients", packageName, "client.go");
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== generated) throw new TypeError(`Generated Google client is stale: ${packageName}`);
    } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, generated); }
  }
  for (const [version, source, moduleName] of [["v1", proto, "google_grpc"], ["v1beta1", betaProto, "google_grpc_beta"]] as const) {
    const generated = renderGoogleProtobufRust([
      { name: `google/cloud/texttospeech/${version}/cloud_tts.proto`, text: source.text },
      ...inputs.filter(source => source.path.includes("/imports/")).map(source => ({ name: source.path.split("/imports/")[1]!, text: source.text })),
    ], `google.cloud.texttospeech.${version}.TextToSpeech`, "StreamingSynthesize");
    const file = path.join(root, "sdks/rust/src/clients", `${moduleName}.rs`);
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== generated) throw new TypeError(`Generated Google client is stale: ${moduleName}`);
    } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, generated); }
  }
  for (const [source, moduleName] of [[stable, "google_rest"], [beta, "google_rest_beta"]] as const) {
    const generated = renderGoogleDiscoveryRust(JSON.parse(source.text), source.url);
    const file = path.join(root, "sdks/rust/src/clients", `${moduleName}.rs`);
    if (process.argv.includes("--check")) {
      if (await readFile(file, "utf8").catch(() => "") !== generated) throw new TypeError(`Generated Google client is stale: ${moduleName}`);
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
  for (const [relative, generated] of [["sdk/generated/clients/camb.ts", outputs.client], ["schemas/generated/camb-languages.ts", outputs.languages], ["sdks/python/speechswitch/clients/camb.py", outputs.python], ["sdks/go/clients/camb/client.go", outputs.go], ["sdks/rust/src/clients/camb.rs", outputs.rust]]) {
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
