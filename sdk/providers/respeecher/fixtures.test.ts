import { expect, test } from "bun:test";
import fixtures from "../../../sdks/fixtures/respeecher.json";
import type { TtsRequest } from "../../../schemas/providers/respeecher/index.ts";
import { synthesize } from "./index.ts";

for (const fixture of fixtures.requests) test(`shared Respeecher request: ${fixture.name}`, async () => {
  const wave = fixture.path.endsWith("bytes");
  const sent: unknown[] = [];
  const items = [];
  for await (const item of synthesize(fixture.request as TtsRequest, { auth: { respeecher: { apiKey: "fixture" } }, transport: "http", fetch: async (url, init) => {
    sent.push({ url: String(url), method: init?.method, headers: init?.headers, redirect: init?.redirect, body: JSON.parse(String(init?.body)) });
    return new Response(wave ? new Uint8Array([0, 255]) : '{"type":"chunk","data":"AP8="}\n', { headers: { "Content-Type": wave ? "audio/wav" : "text/event-stream" } });
  } })) items.push(item);
  expect(items).toEqual([new Uint8Array([0, 255]), { event: "done" }]);
  expect(sent).toEqual([{ url: `https://api.respeecher.com/v1/public/tts${fixture.path}`, method: "POST", headers: { "X-API-Key": "fixture", "Content-Type": "application/json" }, redirect: "error", body: fixture.body }]);
});

for (const fixture of fixtures.jsonl) test(`shared Respeecher JSONL: ${fixture.name}`, async () => {
  const wire = new TextEncoder().encode(fixture.wire);
  for (let split = 0; split <= wire.length; split++) {
    const items = []; let error: unknown;
    try {
      for await (const item of synthesize({ text: "Hi", voice: "custom" }, { auth: { respeecher: { apiKey: "fixture" } }, transport: "http", fetch: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(wire.slice(0, split)); controller.enqueue(wire.slice(split)); controller.close(); },
      })) })) items.push(item);
    } catch (caught) { error = caught; }
    expect(items).toEqual([...fixture.audio.map(bytes => new Uint8Array(bytes)), ...(fixture.error === null ? [{ event: "done" } as const] : [])]);
    expect(error instanceof Error ? error.message : null).toBe(fixture.error);
  }
});
