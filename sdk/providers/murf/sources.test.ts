import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; path: string; sha256: string }[];
test("Murf retains all first-party snapshots unchanged with catalog hashes", () => {
  const sources = catalog.filter(source => source.provider === "murf"); expect(sources.length).toBe(21);
  expect(sources.map(source => source.path.split("/").at(-1)).sort()).toEqual(readdirSync(new URL("schemas/sources/murf/", root)).sort());
  for (const source of sources) expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
});
test("Murf contracts misdescribe streaming bytes and retain deprecated model capabilities", () => {
  const http = JSON.parse(readFileSync(new URL("schemas/sources/murf/00-openapi.json", root), "utf8"));
  const socket = JSON.parse(readFileSync(new URL("schemas/sources/murf/01-asyncapi.json", root), "utf8"));
  expect(http.paths["/v1/speech/stream"].post.responses["200"].content).toEqual({ "application/json": { schema: { $ref: "#/components/schemas/text_to_speech_stream_Response_200" } } });
  expect(http.components.schemas.text_to_speech_stream_Response_200).toEqual({ type: "object", properties: {}, description: "Empty response body", title: "text_to_speech_stream_Response_200" });
  expect(socket.components.schemas.model.enum).toEqual(["falcon-2", "gen2"]);
  expect(socket.channels["/stream-input"].bindings.ws.query.properties.sample_rate).toEqual({ type: "string", default: 24000 });
  expect(http.components.schemas.GenerateSpeechRequest.properties.pronunciationDictionary).toBeUndefined();
  expect(socket.components.schemas.MessagesSendTextVoiceConfig.properties.pronunciation_dictionary).toBeUndefined();
});
