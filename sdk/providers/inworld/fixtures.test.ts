import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { synthesize, type TtsRequest } from "./index.ts";

const fixtures = JSON.parse(readFileSync(new URL("../../../sdks/fixtures/inworld.json", import.meta.url), "utf8"));
const auth = { inworld: { apiKey: "test-key" } };

test("Inworld shared model-specific defaults and native wire settings", async () => {
  for (const fixture of fixtures.http) {
    const output = await Array.fromAsync(synthesize(fixture.request as TtsRequest, { auth, fetch: async (_, init) => {
      expect(JSON.parse(init!.body as string)).toEqual(fixture.body);
      return new Response('{"result":{"audioContent":"AP8="}}\n');
    } }));
    expect(output).toEqual(fixture.request.timestampGranularity ? [{ correlation: "chunk", audio: Uint8Array.of(0, 255), timestamps: [] }] : [Uint8Array.of(0, 255)]);
  }
});

test("Inworld shared independent alignment retains whitespace, phones and visemes", async () => {
  const output = await Array.fromAsync(synthesize({ model: "inworld-tts-2", text: "Hi", voice: "custom", output: { format: "pcm" }, timestampGranularity: "word" }, {
    auth, fetch: async () => new Response(fixtures.timeline.map((v: { packet: unknown }) => JSON.stringify(v.packet)).join("\n")),
  }));
  expect(output).toEqual(fixtures.timeline.map((v: { item: { audio?: { $bytes: number[] } } }) => ({ ...v.item, ...(v.item.audio ? { audio: Uint8Array.from(v.item.audio.$bytes) } : {}) })));
});
