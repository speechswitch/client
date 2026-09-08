import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { TtsRequest } from "./index.ts";
import { synthesize } from "./index.ts";

const fixtures = JSON.parse(readFileSync(new URL("../../../sdks/fixtures/hume.json", import.meta.url), "utf8"));
const auth = { hume: { apiKey: "test-key" } };

test("Hume shared HTTP settings preserve voices, context and per-turn delivery", async () => {
  for (const fixture of fixtures.http) {
    const output = await Array.fromAsync(synthesize(fixture.request as TtsRequest, { auth, fetch: async (_, init) => {
      expect(JSON.parse(init!.body as string)).toEqual(fixture.body);
      return new Response(Uint8Array.of(0, 255));
    } }));
    expect(output).toEqual([Uint8Array.of(0, 255)]);
  }
});

test("Hume shared independent timelines never replay aggregate snippets", async () => {
  const output = await Array.fromAsync(synthesize({ model: "octave-2", text: "Hi", voice: "saved", output: { format: "pcm" }, timestampGranularity: ["word", "phoneme"] }, {
    auth, fetch: async () => new Response(fixtures.timeline.map((v: { packet: unknown }) => JSON.stringify(v.packet)).join("\n")),
  }));
  expect(output).toEqual(fixtures.timeline.map((v: { item: { audio?: { $bytes: number[] } } }) => ({ ...v.item, ...(v.item.audio ? { audio: Uint8Array.from(v.item.audio.$bytes) } : {}) })));
});

test("Hume explicit socket URLs cannot retain stale session settings or empty token auth", async () => {
  const Native = globalThis.WebSocket;
  const stop = new Error("captured handshake");
  let captured: URL | undefined;
  globalThis.WebSocket = class { constructor(url: string | URL) { captured = new URL(url); throw stop; } } as unknown as typeof WebSocket;
  async function* text() { yield "Hi"; }
  try {
    await expect(synthesize({ model: "octave-2", text: text(), voice: "saved", output: { format: "pcm" } }, {
      auth: { hume: { apiKey: "real-key", accessToken: "" } },
      webSocketUrl: "wss://proxy.invalid/custom?%61pi_key=old&access_token=old&context_generation_id=old&temperature=0.5&include_timestamp_types=word&tenant=one",
    }).next()).rejects.toBe(stop);
    expect(captured?.pathname).toBe("/custom");
    expect([...captured!.searchParams]).toEqual([["tenant", "one"], ["api_key", "real-key"], ["format_type", "pcm"], ["version", "2"], ["instant_mode", "true"], ["no_binary", "false"], ["strip_headers", "true"]]);
  } finally { globalThis.WebSocket = Native; }
});
