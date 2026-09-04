import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { synthesize } from "./index.ts";

const auth = { openai: { apiKey: "test-key" } } as const;

describe("OpenAI", () => {
  test("streams raw audio and maps an existing custom voice", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response(Uint8Array.of(1, 2));
    };
    expect(await Array.fromAsync(synthesize({
      text: "hello",
      voice: "voice_1234",
      voiceSource: "custom",
      model: "gpt-4o-mini-tts",
      deliveryInstructions: "Speak warmly",
      output: { format: "ogg_opus" },
      speed: 1.1,
    }, { auth, fetch }))).toEqual([Uint8Array.of(1, 2)]);
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-4o-mini-tts",
      input: "hello",
      voice: { id: "voice_1234" },
      instructions: "Speak warmly",
      response_format: "opus",
      speed: 1.1,
      stream_format: "audio",
    });
  });

  test("keeps legacy model limitations in its request type", () => {
    type Request = Parameters<typeof synthesize>[0];
    expectTypeOf<Extract<Request, { readonly deliveryInstructions?: never }>["deliveryInstructions"]>()
      .toEqualTypeOf<undefined>();
    expectTypeOf<Request["text"]>().toEqualTypeOf<string>();
  });

  test("reports API errors", async () => {
    const fetch: Fetch = async () => new Response("bad key", { status: 401 });
    const stream = synthesize({
      text: "hello",
      voice: "alloy",
      model: "tts-1",
      output: { format: "mp3" },
    }, { auth, fetch });
    await expect(Array.fromAsync(stream)).rejects.toThrow("OpenAI returned HTTP 401: bad key");
  });
});
