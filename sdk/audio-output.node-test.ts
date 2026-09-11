import assert from "node:assert/strict";
import { test } from "node:test";
import { synthesize as amazon } from "./providers/amazon/index.ts";
import { synthesize as xai } from "./providers/xai/index.ts";
import { validateRequest as validateAmazon } from "./generated/validators/amazon.ts";
import { validateRequest as validateXai } from "./generated/validators/xai.ts";

test("Amazon encodes independent codec/container choices into its wire format", async () => {
  const choices = [
    [{ codec: "mp3" }, "mp3"],
    [{ container: "ogg", codec: "vorbis" }, "ogg_vorbis"],
    [{ container: "ogg", codec: "opus" }, "ogg_opus"],
    [{ container: "raw", codec: "pcm", sampleFormat: "int16" }, "pcm"],
    [{ container: "raw", codec: "mulaw" }, "mulaw"],
    [{ container: "raw", codec: "alaw" }, "alaw"],
  ] as const;
  for (const [output, wire] of choices) {
    let body: Record<string, unknown> | undefined;
    await Array.fromAsync(
      amazon(
        { text: "hello", voice: "Joanna", output },
        {
          auth: { aws: { accessKeyId: "test", secretAccessKey: "test", region: "us-east-1" } },
          fetch: async (_url, init) => {
            body = JSON.parse(await new Response(init?.body).text());
            return new Response(Uint8Array.of(1));
          },
        },
      ),
    );
    assert.equal(body?.OutputFormat, wire);
  }
});

test("xAI distinguishes WAV PCM from raw PCM and preserves its wire codec names", async () => {
  const choices = [
    [{ codec: "mp3" }, "mp3"],
    [{ container: "wav", codec: "pcm", sampleFormat: "int16" }, "wav"],
    [{ container: "raw", codec: "pcm" }, "pcm"],
    [{ container: "raw", codec: "mulaw" }, "mulaw"],
    [{ container: "raw", codec: "alaw" }, "alaw"],
  ] as const;
  for (const [output, wire] of choices) {
    let body: Record<string, any> | undefined;
    await Array.fromAsync(
      xai(
        { text: "hello", output },
        {
          auth: { xai: { apiKey: "test" } },
          fetch: async (_url, init) => {
            body = JSON.parse(await new Response(init?.body).text());
            return new Response(Uint8Array.of(1));
          },
        },
      ),
    );
    assert.equal(body?.output_format.codec, wire);
    assert.equal(body?.output_format.container, undefined);
    assert.equal(body?.output_format.sampleFormat, undefined);
  }
});

test("generated checks reject unsupported containers, sample formats, and legacy output fields", () => {
  for (const output of [
    { container: "ogg", codec: "pcm" },
    { container: "wav", codec: "mp3" },
    { container: "raw", codec: "mulaw", sampleFormat: "int16" },
    { codec: "pcm" },
    { format: "mp3" },
  ]) {
    assert.throws(() => validateAmazon({ text: "hello", voice: "Joanna", output }), TypeError);
    assert.throws(() => validateXai({ text: "hello", output }), TypeError);
  }
});

test("base output types exclude impossible combinations before provider selection", () => {
  type Output = import("../schemas/base.ts").TtsOutput;
  const valid: Output[] = [
    { codec: "mp3" },
    { container: "ogg", codec: "opus" },
    { container: "wav", codec: "pcm", sampleFormat: "int16" },
    { container: "raw", codec: "mulaw" },
  ];
  // @ts-expect-error MP3 is not a container for G.711.
  const mp3Mulaw: Output = { container: "mp3", codec: "mulaw" };
  // @ts-expect-error Ogg PCM is not a supported normalized combination.
  const oggPcm: Output = { container: "ogg", codec: "pcm" };
  // @ts-expect-error PCM sample representation does not apply to MP3.
  const mp3Samples: Output = { codec: "mp3", sampleFormat: "int16" };
  // @ts-expect-error PCM needs an explicit raw or WAV container selection.
  const missingContainer: Output = { codec: "pcm" };
  void [valid, mp3Mulaw, oggPcm, mp3Samples, missingContainer];
});
