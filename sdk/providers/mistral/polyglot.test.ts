import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { synthesize } from "./index.ts";

const fixtures: { name: string; contentType: string; body: string; output: unknown[]; error?: string }[] = JSON.parse(readFileSync(new URL("../../../sdks/fixtures/mistral.json", import.meta.url), "utf8"));
for (const fixture of fixtures) test(`shared Mistral protocol: ${fixture.name}`, async () => {
  const data = new TextEncoder().encode(fixture.body);
  for (const split of [0, 1, Math.floor(data.length / 2), data.length]) {
    const output: unknown[] = []; let failure: unknown;
    try {
      for await (const item of synthesize({ text: "Hello" }, { auth: { mistral: { apiKey: "test" } }, fetch: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(data.slice(0, split)); controller.enqueue(data.slice(split)); controller.close(); },
      }), { headers: { "content-type": fixture.contentType } }) })) output.push(item instanceof Uint8Array ? { audio: [...item] } : item);
    } catch (error) { failure = error; }
    expect(output).toEqual(fixture.output);
    expect(failure).toEqual(fixture.error === undefined ? undefined : new TypeError(fixture.error));
  }
});
