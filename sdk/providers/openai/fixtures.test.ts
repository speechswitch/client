import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { synthesize, type TtsRequest } from "./index.ts";

const fixtures = JSON.parse(readFileSync(new URL("../../../sdks/fixtures/openai.json", import.meta.url), "utf8")) as {
  requests: { name: string; request: TtsRequest; wire: object }[];
  streams: { name: string; body: string; output: object[]; error: string | null }[];
};
const auth = { openai: { apiKey: "test" } };
test.each(fixtures.requests)("OpenAI shared request: $name", async ({ request, wire }) => {
  const output = await Array.fromAsync(synthesize(request, { auth, fetch: async (_, init) => {
    expect(JSON.parse(init?.body as string)).toEqual(wire);
    return request.includeUsage
      ? new Response(fixtures.streams[0]!.body, { headers: { "content-type": "text/event-stream" } })
      : new Response(Uint8Array.of(0, 255, 128));
  } }));
  expect(output[0]).toEqual(Uint8Array.of(0, 255, 128));
});
test.each(fixtures.streams)("OpenAI shared stream at every split: $name", async fixture => {
  const data = new TextEncoder().encode(fixture.body);
  for (let split = 0; split <= data.length; split++) {
    const output: object[] = []; let error: string | null = null;
    try {
      for await (const item of synthesize({ text: "Hello", voice: "alloy", model: "gpt-4o-mini-tts", includeUsage: true }, {
        auth, fetch: async () => new Response(new ReadableStream({ start(controller) {
          controller.enqueue(data.slice(0, split)); controller.enqueue(data.slice(split)); controller.close();
        } }), { headers: { "content-type": "text/event-stream", "x-request-id": "" } }),
      })) output.push(item instanceof Uint8Array ? { audio: Array.from(item) } : item);
    } catch (failure) { if (!(failure instanceof Error)) throw failure; error = failure.message; }
    expect({ output, error }).toEqual({ output: fixture.output, error: fixture.error });
  }
});
