import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { synthesize } from "./index.ts";

describe("Resemble Chatterbox", () => {
  test("uploads reference audio, runs the multilingual model, and streams its file", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch: Fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/upload")) return Response.json(["/tmp/reference.wav"]);
      if (url.includes("/run/")) return Response.json({ output: {
        path: "/tmp/output.wav", url: "https://files.example/output.wav", meta: { _type: "gradio.FileData" },
      } });
      return new Response(Uint8Array.of(1, 2));
    };
    expect(await Array.fromAsync(synthesize({
      text: "bonjour",
      model: "chatterbox-multilingual",
      language: "fr",
      referenceAudio: Uint8Array.of(3),
      voiceTuning: { style: 1.2 },
      guidanceScale: 0.7,
      output: { format: "wav" },
    }, { fetch }))).toEqual([Uint8Array.of(1, 2)]);
    expect(calls.map(({ url }) => url)).toEqual([
      "https://resembleai-chatterbox-multilingual-tts-v3.hf.space/gradio_api/upload",
      "https://resembleai-chatterbox-multilingual-tts-v3.hf.space/gradio_api/run/generate_tts_audio",
      "https://files.example/output.wav",
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      text_input: "bonjour", language_id_input: "fr", exaggeration_input: 1.2, cfgw_input: 0.7,
      audio_prompt_path_input: { path: "/tmp/reference.wav" },
    });
  });

  test("maps Turbo sampling controls without requiring a reference", async () => {
    let body: unknown;
    const fetch: Fetch = async (input, init) => {
      if (String(input).includes("/run/")) {
        body = JSON.parse(String(init?.body));
        return Response.json({ output: { path: "/tmp/output.wav", url: "https://files.example/output.wav" } });
      }
      return new Response(Uint8Array.of(4));
    };
    expect(await Array.fromAsync(synthesize({
      text: "hello", model: "chatterbox-turbo", output: { format: "wav" },
      randomSeed: 7, minimumTokenProbability: 0.1, topProbabilityMass: 0.8,
      topTokenCount: 100, repetitionPenalty: 1.5, loudnessNormalization: false,
    }, { fetch }))).toEqual([Uint8Array.of(4)]);
    expect(body).toMatchObject({ seed_num: 7, min_p: 0.1, top_p: 0.8, top_k: 100, repetition_penalty: 1.5, norm_loudness: false });
    expect(body).not.toHaveProperty("audio_prompt_path");
  });

  test("keeps model-specific controls narrowed", () => {
    type Request = Parameters<typeof synthesize>[0];
    expectTypeOf<Extract<Request, { readonly model: "chatterbox-turbo" }>["guidanceScale"]>()
      .toEqualTypeOf<undefined>();
    expectTypeOf<Request["text"]>().toEqualTypeOf<string>();
  });
});
