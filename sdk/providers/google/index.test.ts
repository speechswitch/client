import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, voices } from "./index.ts";

describe("Google Cloud TTS", () => {
  test("keeps input non-streaming", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<string | AsyncIterable<string>>();
  });

  test("maps normalized synthesis to Discovery REST and decodes base64 audio", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return Response.json({ audioContent: "AQID" });
    };
    expect(await Array.fromAsync(synthesize({
      text: "<speak>Hello</speak>",
      inputType: "ssml",
      voice: "en-US-Chirp3-HD-Achernar",
      model: "chirp-3-hd",
      language: "en-US",
      output: { format: "ogg_opus", sampleRateHz: 48000 },
      speed: 1.1,
      pitchSemitones: 2,
      volumeDb: -3,
    }, { auth: { google: { apiKey: "key" } }, fetch }))).toEqual([Uint8Array.of(1, 2, 3)]);
    expect(url).toBe("https://texttospeech.googleapis.com/v1/text:synthesize?key=key");
    expect(JSON.parse(String(init?.body))).toEqual({
      input: { ssml: "<speak>Hello</speak>" },
      voice: {
        languageCode: "en-US",
        name: "en-US-Chirp3-HD-Achernar",
        modelName: "chirp-3-hd",
      },
      audioConfig: {
        audioEncoding: "OGG_OPUS",
        sampleRateHertz: 48000,
        speakingRate: 1.1,
        pitch: 2,
        volumeGainDb: -3,
      },
    });
  });

  test("supports OAuth and lists voices", async () => {
    let authorization = "";
    const fetch: Fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ voices: [{ name: "custom", languageCodes: ["en-US"] }] });
    };
    expect(await voices({
      auth: { google: { accessToken: "token" } },
      language: "en-US",
      fetch,
    })).toHaveLength(1);
    expect(authorization).toBe("Bearer token");
  });
});
