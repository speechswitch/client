import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
const catalog = parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; path: string; url: string; sha256: string }[];
test("MiniMax catalogs every unchanged first-party contract and CLI source", () => {
  const entries = catalog.filter(entry => entry.provider === "minimax");
  expect(entries.map(entry => entry.path.split("/").at(-1)).sort()).toEqual(readdirSync(new URL("schemas/sources/minimax/", root)).sort());
  expect(entries.length).toBe(14);
  expect(entries.map(entry => new URL(entry.url).hostname)).toEqual([
    ...Array(8).fill("platform.minimax.io"), ...Array(6).fill("raw.githubusercontent.com"),
  ]);
  for (const entry of entries) {
    expect(createHash("sha256").update(readFileSync(new URL(entry.path, root))).digest("hex")).toBe(entry.sha256);
  }
});
test("MiniMax contracts do not warrant generated wire clients", () => {
  const http = JSON.parse(readFileSync(new URL("schemas/sources/minimax/00-openapi.json", root), "utf8")).components.schemas;
  const ws = JSON.parse(readFileSync(new URL("schemas/sources/minimax/05-asyncapi-bidi.json", root), "utf8")).components.schemas;
  expect(http.T2aV2Resp.properties.data.type).toBe("object");
  expect(http.T2aV2Resp.properties.data.nullable).toBeUndefined();
  expect(http.T2aV2Resp.properties.data.description).toBe("The synthesized audio data object. The returned data object may be null, so a null check is required.");
  expect(ws.SendTaskStartEvent.properties.timbre_weights).toEqual({ $ref: "#/components/schemas/TimbreWeights" });
  expect(ws.TimbreWeights.type).toBe("object");
  expect(ws.SendTaskStartEvent.properties.subtitle_enable.type).toBe("boolean");
  expect(Object.keys(ws.ReceiveTaskContinuedEvent.properties.data.properties)).toEqual(["audio"]);
  expect(Object.keys(ws.ReceiveTaskContinuedEvent.properties)).toEqual(["data", "trace_id", "session_id", "event", "is_final", "extra_info", "base_resp", "connect_id"]);
});
