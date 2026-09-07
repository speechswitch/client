import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { synthesize } from "./index.ts";
import { decodeMessage } from "./protocol.ts";
import type { TtsRequest } from "../../../schemas/providers/microsoft/index.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../sdks/fixtures/microsoft.json", import.meta.url), "utf8"));
test("Microsoft shared fixture preserves SSML bytes and output tokens", async () => {
  for (const [output, format] of fixture.formats) {
    const calls: unknown[] = [];
    const items = await Array.fromAsync(synthesize({ ...fixture.request, output } as TtsRequest, { auth: { microsoft: { apiKey: "key", region: "eastus" } }, fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method, headers: init?.headers, body: init?.body });
      return new Response(Uint8Array.of(1, 2));
    } }));
    expect(calls).toEqual([{ url: "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1", method: "POST", headers: { "Ocp-Apim-Subscription-Key": "key", "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": format, "User-Agent": "speechswitch" }, body: fixture.ssml }]);
    expect(items).toEqual([Uint8Array.of(1, 2)]);
  }
});
test("Microsoft shared metadata preserves native timelines and opaque animation", () => {
  expect(decodeMessage(`Path: audio.metadata\r\nX-RequestId: job\r\n\r\n${JSON.stringify(fixture.metadata)}`)).toEqual({ type: "metadata", requestId: "job", timestamps: fixture.timestamps, durationMs: 10 });
});
