import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, voices } from "./index.ts";

const auth = { microsoft: { apiKey: "test-key" } } as const;

describe("Microsoft Azure Speech", () => {
  test("keeps REST input non-streaming without widening Amazon", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
  });

  test("builds SSML and streams byte-native MP3 audio", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(1, 2));
    };
    expect(await Array.fromAsync(synthesize({
      text: "one < two",
      voice: "en-US-Ava:DragonHDLatestNeural",
      language: "en-US",
      output: { format: "mp3", sampleRateHz: 24000, bitRateBps: 160000 },
    }, { auth, fetch, region: "eastus" }))).toEqual([Uint8Array.of(1, 2)]);
    expect(url).toBe("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1");
    const headers = new Headers(init?.headers);
    expect(headers.get("ocp-apim-subscription-key")).toBe("test-key");
    expect(headers.get("x-microsoft-outputformat")).toBe("audio-24khz-160kbitrate-mono-mp3");
    expect(init?.body).toBe('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="en-US-Ava:DragonHDLatestNeural">one &lt; two</voice></speak>');
  });

  test("passes authored SSML through and preserves a custom deployment URL", async () => {
    let body: BodyInit | null | undefined;
    let url = "";
    const fetch: Fetch = async (input, init) => {
      url = String(input);
      body = init?.body;
      return new Response(Uint8Array.of(3));
    };
    await Array.fromAsync(synthesize({
      text: "<speak>custom</speak>",
      inputType: "ssml",
      output: { format: "pcm", sampleRateHz: 16000 },
    }, {
      auth,
      fetch,
      synthesisUrl: "https://eastus.voice.speech.microsoft.com/cognitiveservices/v1?deploymentId=voice-id",
    }));
    expect(url).toBe("https://eastus.voice.speech.microsoft.com/cognitiveservices/v1?deploymentId=voice-id");
    expect(body).toBe("<speak>custom</speak>");
  });

  test("lists live voices with bearer auth from resource endpoints", async () => {
    let url = "";
    let authorization = "";
    const fetch: Fetch = async (input, init) => {
      url = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json([{
        Name: "Microsoft Voice",
        DisplayName: "Ava",
        LocalName: "Ava",
        ShortName: "en-US-AvaNeural",
        Gender: "Female",
        Locale: "en-US",
        LocaleName: "English (United States)",
        SampleRateHertz: "48000",
        VoiceType: "Neural",
        Status: "GA",
      }]);
    };
    expect(await voices({
      auth: { microsoft: { accessToken: "token" } },
      resourceEndpoint: "https://speech.example.azure.com",
      fetch,
    })).toHaveLength(1);
    expect(url).toBe("https://speech.example.azure.com/tts/cognitiveservices/voices/list");
    expect(authorization).toBe("Bearer token");
  });
});
