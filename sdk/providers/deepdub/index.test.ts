import { describe, expect, expectTypeOf, test } from "bun:test";
import type { TtsRequest } from "../../../schemas/providers/deepdub/index.ts";
import type { Fetch } from "../../runtime/fetch.ts";
import { synthesize } from "./index.ts";

const request = {
  text: "hello",
  voice: "voice-prompt",
  voiceSource: "custom",
  model: "phantom-x-3.2",
  language: "en-US",
  output: { format: "opus", sampleRateHz: 24000 },
} as const;

describe("Deepdub", () => {
  test("keeps input static and seed support model-specific", () => {
    type Modern = Extract<TtsRequest, { readonly model: "lightning-2.5" | "phantom-x-3.2" }>;
    type Original = Extract<TtsRequest, { readonly model: "og-1.1" }>;
    expectTypeOf<Modern["text"]>().toEqualTypeOf<string>();
    expectTypeOf<Modern["randomSeed"]>().toEqualTypeOf<undefined>();
    expectTypeOf<Original["randomSeed"]>().toEqualTypeOf<number | undefined>();
  });

  test("streams raw response bytes and maps voice and model controls", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetch: Fetch = async (input, value) => { url = String(input); init = value; return new Response(Uint8Array.of(1, 2)); };
    const values = await Array.fromAsync(synthesize({
      ...request,
      referenceAudio: Uint8Array.of(3, 4),
      voiceVariant: "performance-prompt",
      targetDurationSeconds: 1.5,
      temperature: 0.7,
      deliveryVariance: 0.6,
      voiceTuning: { speakerBoost: true },
      durationStretching: true,
      latencyOptimization: "aggressive",
      audioEnhancement: true,
      loudnessNormalization: true,
      accentBlend: { baseLocale: "en-US", targetLocale: "fr-FR", ratio: 0.3 },
      targetGender: "female",
    }, { auth: { deepdub: { apiKey: "dd-key" } }, fetch }));
    expect(values).toEqual([Uint8Array.of(1, 2)]);
    expect(url).toBe("https://restapi.deepdub.ai/api/v1/tts");
    expect(init?.headers).toEqual({ "content-type": "application/json", "x-api-key": "dd-key" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "dd-etts-3.2",
      targetText: "hello",
      locale: "en-US",
      voicePromptId: "voice-prompt",
      voiceReference: "AwQ=",
      performanceReferencePromptId: "performance-prompt",
      format: "opus",
      sampleRate: 24000,
      targetDuration: 1.5,
      variance: 0.6,
      temperature: 0.7,
      promptBoost: true,
      superStretch: true,
      realtime: true,
      cleanAudio: true,
      autoGain: true,
      accentControl: { accentBaseLocale: "en-US", accentLocale: "fr-FR", accentRatio: 0.3 },
      targetGender: "female",
    });
  });

  test("maps the legacy seeded model and reports API errors", async () => {
    let body: unknown;
    const fetch: Fetch = async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json({ success: false, message: "Insufficient credits" }, { status: 402 }); };
    await expect(Array.fromAsync(synthesize({ ...request, model: "og-1.1", randomSeed: 42 }, { auth: { deepdub: { apiKey: "dd-key" } }, fetch }))).rejects.toThrow("Deepdub returned HTTP 402: Insufficient credits");
    expect(body).toMatchObject({ model: "dd-etts-1.1", seed: 42 });
  });
});
