import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; name: string; path: string; sha256: string; method?: string; url: string }[];
test("Rime catalogs every unchanged snapshot with its upstream URL, method and hash", () => {
  const sources = catalog.filter(source => source.provider === "rime");
  expect(sources.length).toBe(35);
  expect(sources.map(source => source.name).sort()).toEqual(readdirSync(new URL("schemas/sources/rime/", root)).sort());
  for (const source of sources) {
    expect(source.method).toBe("GET"); expect(new URL(source.url).origin).toBe("https://docs.rime.ai");
    expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
  }
});

// Inspect the embedded endpoint object only to demonstrate why it is unsuitable
// for codegen. Do not evaluate MDX or use this partial inspection as a wire parser.
function endpoint(file: string) {
  const html = readFileSync(new URL(`schemas/sources/rime/${file}`, root), "utf8");
  const payload = [...html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/g)]
    .map(match => JSON.parse(match[1]!)).filter(value => value[0] === 1).map(value => value[1]).join("");
  const needle = '"endpoint":'; const position = payload.indexOf(needle);
  if (position < 0) throw new TypeError("Snapshot has no endpoint object");
  const start = position + needle.length; let depth = 0; let string = false; let escaped = false;
  for (let index = start; index < payload.length; index++) {
    const char = payload[index];
    if (string) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') string = false;
    } else if (char === '"') string = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return JSON.parse(payload.slice(start, index + 1));
  }
  throw new TypeError("Snapshot has an incomplete endpoint object");
}

test("embedded contracts have empty responses, prose-only constraints and misplaced WebSocket parameters", () => {
  const http = endpoint("21-coda-http.html");
  expect(http.path).toBe("/v1/rime-tts"); expect(http.response).toEqual({});
  const fields = http.request.body["application/json"].schemaArray[0].properties;
  expect(fields.modelId).toEqual([{ type: "string", description: "Set to `coda` to select the Coda voice lineup." }]);
  expect(fields.timeScaleFactor).toEqual([{ type: "number", description: "The time scaling factor. Accepted range is 0.4 to 2.5; values outside it are clamped without an error. A value above 1.0 slows down the audio, a value below 1.0 speeds up the audio." }]);
  const websocket = endpoint("26-mistv3-websockets-json.html");
  expect(websocket.path).toBe("/ws3"); expect(websocket.method).toBe("get");
  expect(websocket.request.parameters).toEqual({ query: {}, header: {}, cookie: {}, path: {} });
  expect(websocket.response).toEqual({});
  const parameters = websocket.request.body["application/json"].schemaArray[0].properties;
  expect(Object.keys(parameters)).toEqual(["speaker", "modelId", "audioFormat", "lang", "pauseBetweenBrackets", "samplingRate", "inlineSpeedAlpha", "speedAlpha", "segment"]);
  expect(parameters.timeScaleFactor).toBeUndefined(); expect(parameters.phonemizeBetweenBrackets).toBeUndefined();
});
