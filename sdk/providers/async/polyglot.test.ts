import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { synthesize, type TtsRequest } from "./index.ts";

const fixtures: { name: string; mode: string; status: number; bodyBytes?: number[]; bodyText?: string; audio: number[]; envelopes: unknown[]; error?: string }[] = JSON.parse(readFileSync(new URL("../../../sdks/fixtures/async.json", import.meta.url), "utf8"));
for (const fixture of fixtures) test(`shared Async protocol: ${fixture.name}`, async () => {
  const data = fixture.bodyBytes ? new Uint8Array(fixture.bodyBytes) : new TextEncoder().encode(fixture.bodyText);
  const request: TtsRequest = fixture.mode === "timestamped"
    ? { model: "castleflow-1.0", voice: "owned", text: "Hi", output: { format: "pcm", sampleRateHz: 24000 }, timestampGranularity: "word" }
    : { model: "castleflow-1.0", voice: "owned", text: "Hi", output: { format: fixture.mode === "plain" ? "wav" : "pcm", sampleRateHz: 24000 } };
  for (let split = 0; split <= data.length; split++) {
    const audio: number[] = []; const envelopes: unknown[] = []; let failure: unknown;
    try {
      for await (const item of synthesize(request, { auth: { async: { apiKey: "test" } }, fetch: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(data.slice(0, split)); controller.enqueue(data.slice(split)); controller.close(); },
      }), { status: fixture.status }) })) {
        if (item instanceof Uint8Array) audio.push(...item);
        else envelopes.push({ ...item, audio: [...item.audio] });
      }
    } catch (error) { failure = error; }
    expect({ audio, envelopes }).toEqual({ audio: fixture.audio, envelopes: fixture.envelopes });
    expect(failure).toEqual(fixture.error === undefined ? undefined : new TypeError(fixture.error));
  }
});
