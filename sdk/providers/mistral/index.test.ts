import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import {
  createVoice,
  deleteVoice,
  synthesize,
  updateVoice,
  voice,
  voiceSample,
  voices,
} from "./index.ts";

const auth = { mistral: { apiKey: "test-key" } } as const;
const voiceResponse = {
  name: "Mine",
  id: "voice-id",
  created_at: "2026-01-01T00:00:00Z",
  user_id: "user-id",
};

describe("Mistral Voxtral", () => {
  test("keeps voice selection and reference audio independent", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
    const cloned: Parameters<typeof synthesize>[0] = {
      text: "hello",
      referenceAudio: Uint8Array.of(1),
      model: "voxtral-mini-tts-2603",
      output: { format: "wav" },
    };
    expect(cloned.referenceAudio).toEqual(Uint8Array.of(1));
  });

  test("streams typed audio deltas for saved voices", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, request) => {
      url = String(input);
      init = request;
      return new Response([
        'event: speech.audio.delta\ndata: {"type":"speech.audio.delta","audio_data":"AQI="}\n\n',
        'event: speech.audio.done\ndata: {"type":"speech.audio.done","usage":{}}\n\n',
      ].join(""));
    };
    expect(await Array.fromAsync(synthesize({
      text: "hello",
      voice: "voice-id",
      model: "voxtral-mini-tts-2603",
      output: { format: "ogg_opus" },
    }, { auth, fetch }))).toEqual([Uint8Array.of(1, 2)]);
    expect(url).toBe("https://api.mistral.ai/v1/audio/speech");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "voxtral-mini-tts-2603",
      stream: true,
      voice_id: "voice-id",
      input: "hello",
      response_format: "opus",
    });
  });

  test("sends reference audio for zero-shot cloning", async () => {
    let body = "";
    const fetch: Fetch = async (_input, init) => {
      body = String(init?.body);
      return new Response('data: {"type":"speech.audio.done","usage":{}}\n\n');
    };
    await Array.fromAsync(synthesize({
      text: "hello",
      referenceAudio: Uint8Array.of(1, 2),
      model: "voxtral-mini-tts-2603",
      output: { format: "mp3" },
    }, { auth, fetch }));
    expect(JSON.parse(body).ref_audio).toBe("AQI=");
  });

  test("exposes saved custom voice management and samples", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetch: Fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? String(init.body) : undefined });
      if (String(input).endsWith("/sample")) return new Response(Uint8Array.of(4, 5));
      if (String(input).includes("?")) return Response.json({ items: [voiceResponse], total: 1, page: 1, page_size: 1, total_pages: 1 });
      return Response.json(voiceResponse);
    };
    expect((await voices({ auth, fetch, limit: 1, offset: 0 })).items).toHaveLength(1);
    expect((await voice("voice-id", { auth, fetch })).id).toBe("voice-id");
    expect((await createVoice({ name: "Mine", referenceAudio: Uint8Array.of(1) }, { auth, fetch })).id).toBe("voice-id");
    await updateVoice("voice-id", { name: "New" }, { auth, fetch });
    await deleteVoice("voice-id", { auth, fetch });
    expect(await Array.fromAsync(voiceSample("voice-id", { auth, fetch }))).toEqual([Uint8Array.of(4, 5)]);
    expect(calls.map(({ method }) => method)).toEqual(["GET", "GET", "POST", "PATCH", "DELETE", "GET"]);
    expect(JSON.parse(calls[2]!.body!)).toEqual({ name: "Mine", sample_audio: "AQ==" });
  });
});
