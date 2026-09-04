import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize } from "./index.ts";

const auth = { minimax: { apiKey: "test-key" } } as const;

describe("MiniMax", () => {
  test("keeps HTTP input non-streaming and narrows model-specific emotions", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
    const valid: Parameters<typeof synthesize>[0] = {
      text: "hello",
      voice: "voice",
      model: "speech-2.6-hd",
      emotion: "whisper",
      output: { format: "pcm", sampleRateHz: 24000 },
    };
    expect(valid.emotion).toBe("whisper");
  });

  test("decodes low-latency SSE chunks without requesting the final aggregate", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response([
        'data: {"data":{"audio":"0102","status":1},"base_resp":{"status_code":0}}\n\n',
        'data: {"data":{"audio":"03","status":1},"base_resp":{"status_code":0}}\n\n',
        'data: {"data":{"status":2},"base_resp":{"status_code":0}}\n\n',
      ].join(""), { headers: { "content-type": "text/event-stream" } });
    };
    expect(await Array.fromAsync(synthesize({
      text: "hello",
      voice: "English_Graceful_Lady",
      model: "speech-2.8-hd",
      language: "English",
      output: { format: "mp3", sampleRateHz: 32000, bitRateBps: 128000 },
      speed: 1.1,
      volumeScale: 1.5,
      pitchSemitones: 2,
      emotion: "happy",
      textNormalization: true,
      replacements: [{ pattern: "read", replacement: "(riːd)" }],
    }, { auth, fetch }))).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3)]);
    expect(url).toBe("https://api.minimax.io/v1/t2a_v2");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "speech-2.8-hd",
      text: "hello",
      stream: true,
      stream_options: { exclude_aggregated_audio: true },
      voice_setting: {
        voice_id: "English_Graceful_Lady",
        speed: 1.1,
        vol: 1.5,
        pitch: 2,
        emotion: "happy",
        text_normalization: true,
      },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      pronunciation_dict: { tone: ["read/(riːd)"] },
      language_boost: "English",
      output_format: "hex",
    });
  });

  test("surfaces MiniMax application errors returned with HTTP 200", async () => {
    const fetch: Fetch = async () => new Response(
      'data: {"base_resp":{"status_code":1002,"status_msg":"rate limit exceeded"}}\n\n',
    );
    await expect(Array.fromAsync(synthesize({
      text: "hello",
      voice: "voice",
      model: "speech-02-turbo",
      output: { format: "mulaw", sampleRateHz: 8000 },
    }, { auth, fetch }))).rejects.toThrow("MiniMax error 1002: rate limit exceeded");
  });
});
