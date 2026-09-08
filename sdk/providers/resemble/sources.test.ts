import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
function json(file: string) { return JSON.parse(readFileSync(new URL(`schemas/sources/resemble/${file}`, root), "utf8")); }
const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; path: string; sha256: string }[];
test("Resemble preserves all raw sources unchanged with catalog hashes", () => {
  const sources = catalog.filter(source => source.provider === "resemble"); expect(sources.length).toBe(14);
  expect(sources.map(source => source.path.split("/").at(-1)).sort()).toEqual(readdirSync(new URL("schemas/sources/resemble/", root)).sort());
  for (const source of sources) expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
});
test("Resemble manifests preserve exact positional inputs independently of Python signatures", () => {
  expect(json("00-gradio-schema.json").named_endpoints["/generate_tts_audio"].parameters.map((value: { parameter_name: string }) => value.parameter_name)).toEqual(["text_input", "audio_prompt_path_input", "exaggeration_input", "temperature_input", "seed_num_input", "cfgw_input", "vad_trim_input"]);
  expect(json("01-gradio-schema.json").named_endpoints["/generate_tts_audio"].parameters.map((value: { parameter_name: string }) => value.parameter_name)).toEqual(["text_input", "audio_prompt_path_input", "language_id_input", "exaggeration_input", "temperature_input", "seed_num_input", "cfgw_input"]);
  expect(json("02-gradio-schema.json").named_endpoints["/generate"].parameters.map((value: { parameter_name: string }) => value.parameter_name)).toEqual(["text", "audio_prompt_path", "temperature", "seed_num", "min_p", "top_p", "top_k", "repetition_penalty", "norm_loudness"]);
});
test("Resemble manifest prose bounds and wrong default URLs cannot drive a complete wire client", () => {
  const endpoint = json("02-gradio-schema.json").named_endpoints["/generate"];
  expect(endpoint.parameters[2].type).toEqual({ type: "number", description: "numeric value between 0.05 and 2.0" });
  expect(endpoint.parameters[1].type.type).toBe("object");
  expect(endpoint.parameters[1].parameter_default.url).toBe("https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav");
  const config = json("05-turbo-config.json");
  const reference = config.components.find((value: { id: number }) => value.id === 15).props.value;
  expect(endpoint.parameters[1].parameter_default.path).toBe(reference.path);
  expect(reference.url).toBe(`${config.root}/gradio_api/file=${reference.path}`);
  expect(config.dependencies.find((value: { api_name: string }) => value.api_name === "generate").types).toEqual({ generator: false, cancel: false });
});
test.each(["03-base-config.json", "04-multilingual-config.json", "05-turbo-config.json"])("Resemble %s advertises completed audio, not incremental byte output", file => {
  const config = json(file);
  const operations = config.dependencies.filter((value: { api_name: string }) => value.api_name === "generate" || value.api_name === "generate_tts_audio");
  expect(operations.length).toBe(1); expect(operations[0].types).toEqual({ generator: false, cancel: false });
  const output = config.components.find((value: { id: number }) => value.id === operations[0].outputs[0]);
  expect(output.type).toBe("audio"); expect(output.props.streaming).toBe(false);
});
