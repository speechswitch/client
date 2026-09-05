import { describe, expect, expectTypeOf, test } from "bun:test";
import { DeepdubError, synthesize, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { TtsRequest as AmazonRequest } from "../../../schemas/providers/amazon/index.ts";

const base = { model: "phantom-x-3.2", voice: "custom-voice", language: "en-US", output: { format: "mp3" } } as const;
const auth = { deepdub: { apiKey: "test-key" } } as const;

function opusHeader(codec = "OpusHead", segments = 1) {
  const bytes = new Uint8Array(27 + segments + 19);
  bytes.set(new TextEncoder().encode("OggS")); bytes[5] = 2; bytes[26] = segments;
  bytes[27] = 19; bytes.set(new TextEncoder().encode(codec), 27 + segments);
  bytes[27 + segments + 8] = 1; bytes[27 + segments + 9] = 1;
  return bytes;
}

describe("Deepdub byte HTTP", () => {
  test("streams without buffering, preserves the API prefix, and selects a custom voice", async () => {
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1, 2)); finish = () => controller.close(); } });
    const stream = synthesize({ ...base, text: "hello" }, { auth, requestId: "trace", fetch: async (url, init) => {
      expect(String(url)).toBe("https://restapi.deepdub.ai/api/v1/tts");
      expect(init?.headers).toEqual({ "x-api-key": "test-key", "content-type": "application/json" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(String(init?.body))).toEqual({ generationId: "trace", model: "dd-etts-3.2", targetText: "hello", locale: "en-US", voicePromptId: "custom-voice", format: "mp3", sampleRate: 48000, cleanAudio: true });
      return new Response(body);
    } });
    expect((await stream.next()).value).toEqual(Uint8Array.of(1, 2)); finish(); expect((await stream.next()).done).toBe(true);
  });

  test.each([["og-1.1", "dd-etts-1.1"], ["lightning-2.5", "dd-etts-2.5"], ["phantom-x-3.2", "dd-etts-3.2"]] as const)("maps catalog model %s exactly", async (model, wireModel) => {
    await Array.fromAsync(synthesize({ ...base, model, text: "hello" }, { auth, fetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body)).model).toBe(wireModel); return new Response(Uint8Array.of(1));
    } }));
  });

  test("reference audio works alone, with voice selection, and independently of performance guidance", async () => {
    for (const voice of [undefined, "existing"]) {
      await Array.fromAsync(synthesize({ ...base, text: "hello", voice, referenceAudio: Uint8Array.of(1, 2, 3), deliveryReference: "performance" }, { auth, fetch: async (_url, init) => {
        const wire = JSON.parse(String(init?.body));
        expect(wire.voiceReference).toBe("AQID"); expect(wire.performanceReferencePromptId).toBe("performance");
        if (voice === undefined) expect(wire).not.toHaveProperty("voicePromptId"); else expect(wire.voicePromptId).toBe(voice);
        return new Response(Uint8Array.of(1));
      } }));
    }
  });

  test("maps independent controls without nesting or a false quality/latency equivalence", async () => {
    await Array.fromAsync(synthesize({ ...base, text: "hello", model: "og-1.1", speed: 1.25, randomSeed: 42, temperature: 0.7, deliveryVariance: 0.2, voiceBoost: false, durationStretching: true, processingPriority: "realtime", audioEnhancement: false, automaticGainControl: true, speakerGender: "female", accentBlend: { baseLocale: "en-US", targetLocale: "fr-FR", ratio: 0.3 } }, { auth, fetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ tempo: 1.25, seed: 42, temperature: 0.7, variance: 0.2, promptBoost: false, superStretch: true, realtime: true, cleanAudio: false, autoGain: true, targetGender: "female", accentControl: { accentBaseLocale: "en-US", accentLocale: "fr-FR", accentRatio: 0.3 } });
      return new Response(Uint8Array.of(1));
    } }));
  });

  test("duration uses documented targetDuration in seconds and preserves explicit standard priority", async () => {
    await Array.fromAsync(synthesize({ ...base, text: "hello", targetDurationMs: 1250, processingPriority: "standard" }, { auth, fetch: async (_url, init) => {
      const wire = JSON.parse(String(init?.body)); expect(wire.targetDuration).toBe(1.25); expect(wire.realtime).toBe(false);
      expect(wire).not.toHaveProperty("tempo"); expect(wire).not.toHaveProperty("duration"); return new Response(Uint8Array.of(1));
    } }));
  });

  test.each([undefined, 16000])("mulaw resolves its default independently from explicit sample rate %s", async sampleRateHz => {
    await Array.fromAsync(synthesize({ ...base, text: "hello", output: { format: "mulaw", sampleRateHz } }, { auth, baseUrl: "https://eu-restapi.deepdub.ai/api/v1/", fetch: async (url, init) => {
      expect(String(url)).toBe("https://eu-restapi.deepdub.ai/api/v1/tts");
      expect(JSON.parse(String(init?.body))).toMatchObject({ format: "mulaw", sampleRate: sampleRateHz ?? 8000 }); return new Response(Uint8Array.of(1));
    } }));
  });

  test("does not discard a caller's proxy base path", async () => {
    await Array.fromAsync(synthesize({ ...base, text: "hello" }, { auth, baseUrl: "https://proxy.invalid/deepdub/v1", fetch: async url => {
      expect(String(url)).toBe("https://proxy.invalid/deepdub/v1/tts"); return new Response(Uint8Array.of(1));
    } }));
  });

  test("preserves HTTP status, structured message, and upstream generation ID", async () => {
    for (const status of [400, 401, 402, 429, 500]) {
      const stream = synthesize({ ...base, text: "hello" }, { auth, requestId: "local", fetch: async () => new Response(JSON.stringify({ success: false, message: "request failed" }), { status, headers: { "x-generation-id": "upstream" } }) });
      try { await stream.next(); throw new Error("expected error"); } catch (error) {
        expect(error).toBeInstanceOf(DeepdubError); expect(error).toMatchObject({ statusCode: status, generationId: "upstream" }); expect(String(error)).toContain("request failed");
      }
    }
    await expect(synthesize({ ...base, text: "hello" }, { auth, fetch: async () => new Response("bad gateway", { status: 502 }) }).next()).rejects.toThrow("bad gateway");
  });

  test("early exit cancels HTTP audio and never refetches it", async () => {
    let cancelled = false; let calls = 0;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; } });
    const stream = synthesize({ ...base, text: "hello" }, { auth, fetch: async () => { calls++; return new Response(body); } });
    await stream.next(); await stream.return!(); expect(cancelled).toBe(true); expect(calls).toBe(1);
  });

  test("pre-abort avoids the request and mid-stream abort is propagated", async () => {
    const controller = new AbortController(); controller.abort(new Error("stop")); let calls = 0;
    await expect(synthesize({ ...base, text: "hello" }, { auth, signal: controller.signal, fetch: async () => { calls++; return new Response(); } }).next()).rejects.toThrow("stop"); expect(calls).toBe(0);
    const active = new AbortController();
    const stream = synthesize({ ...base, text: "hello" }, { auth, signal: active.signal, fetch: async (_url, init) => {
      expect(init?.signal).toBe(active.signal);
      return new Response(new ReadableStream<Uint8Array>({ start(output) {
        output.enqueue(Uint8Array.of(1)); active.signal.addEventListener("abort", () => output.error(active.signal.reason), { once: true });
      } }));
    } });
    await stream.next(); const pending = stream.next(); active.abort(new Error("mid-stream")); await expect(pending).rejects.toThrow("mid-stream");
  });

  test("resolves explicit auth before Speechswitch and provider environment variables", async () => {
    const oldShared = process.env.SPEECHSWITCH_DEEPDUB_API_KEY; const oldProvider = process.env.DEEPDUB_API_KEY;
    try {
      process.env.SPEECHSWITCH_DEEPDUB_API_KEY = "shared"; process.env.DEEPDUB_API_KEY = "provider";
      for (const expected of ["test-key", "shared", "provider"]) {
        if (expected === "provider") delete process.env.SPEECHSWITCH_DEEPDUB_API_KEY;
        await Array.fromAsync(synthesize({ ...base, text: "hello" }, { ...(expected === "test-key" ? { auth } : {}), fetch: async (_url, init) => {
          expect(new Headers(init?.headers).get("x-api-key")).toBe(expected); return new Response(Uint8Array.of(1));
        } }));
      }
      delete process.env.DEEPDUB_API_KEY;
      await expect(synthesize({ ...base, text: "hello" }).next()).rejects.toThrow("Missing auth.deepdub.apiKey");
    } finally {
      if (oldShared === undefined) delete process.env.SPEECHSWITCH_DEEPDUB_API_KEY; else process.env.SPEECHSWITCH_DEEPDUB_API_KEY = oldShared;
      if (oldProvider === undefined) delete process.env.DEEPDUB_API_KEY; else process.env.DEEPDUB_API_KEY = oldProvider;
    }
  });

  test.each([
    [{ speed: 1, targetDurationMs: 2000 }, "mutually exclusive"], [{ targetDurationMs: 0 }, "positive"], [{ targetDurationMs: Infinity }, "positive"],
    [{ speed: 0.1 }, "speed"], [{ temperature: 1.1 }, "temperature"], [{ deliveryVariance: -1 }, "deliveryVariance"],
    [{ randomSeed: 42 }, "randomSeed"], [{ model: "og-1.1", randomSeed: 1.5 }, "randomSeed"],
    [{ voice: undefined }, "existing voice or reference"], [{ model: "invented" }, "model"],
    [{ referenceAudio: new Uint8Array() }, "non-empty Uint8Array"], [{ referenceAudio: "AQID" }, "non-empty Uint8Array"],
    [{ accentBlend: { baseLocale: "en-US", targetLocale: "fr-FR", ratio: 2 } }, "ratio"],
    [{ accentBlend: { baseLocale: "en-US", ratio: 0.5 } }, "both locales"],
    [{ output: { format: "mp3", sampleRateHz: 0 } }, "positive integer"], [{ output: { format: "wav" } }, "HTTP output"],
  ] as const)("rejects invalid JS request %j before billing", async (patch, message) => {
    let fetched = false;
    await expect(synthesize({ ...base, text: "hello", ...patch } as TtsRequest, { auth, fetch: async () => { fetched = true; return new Response(); } }).next()).rejects.toThrow(message);
    expect(fetched).toBe(false);
  });
});

describe("Deepdub Opus codec verification", () => {
  test("validates a split Ogg header without waiting for the body to finish", async () => {
    const header = opusHeader(); let finish!: () => void;
    const stream = synthesize({ ...base, text: "hello", output: { format: "ogg_opus", sampleRateHz: 16000 } }, { auth, fetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ format: "opus", sampleRate: 16000 });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        for (const byte of header) controller.enqueue(Uint8Array.of(byte)); finish = () => controller.close();
      } }));
    } });
    expect((await stream.next()).value).toEqual(header.subarray(0, 1)); finish();
    const rest = await Array.fromAsync(stream); expect(rest.flatMap(bytes => [...bytes])).toEqual([...header.subarray(1)]);
  });

  test("uses the Ogg segment count to locate the codec instead of a hard-coded offset", async () => {
    const header = opusHeader("OpusHead", 255);
    expect(await Array.fromAsync(synthesize({ ...base, text: "hello", output: { format: "ogg_opus" } }, { auth, fetch: async () => new Response(header) }))).toEqual([header]);
  });

  test.each([opusHeader("\x01vorbis"), Uint8Array.of(1, 2, 3), new Uint8Array(40)])("rejects mislabeled or malformed Opus and cancels the body", async header => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(header); if (header.length < 27) controller.close(); }, cancel() { cancelled = true; } });
    await expect(synthesize({ ...base, text: "hello", output: { format: "ogg_opus" } }, { auth, fetch: async () => new Response(body) }).next()).rejects.toThrow();
    if (header.length >= 27) expect(cancelled).toBe(true);
  });
});

test("Deepdub request invariants and provider-specific streaming return types are checked", () => {
  async function* text() { yield "hello"; }
  const valid: TtsRequest = { ...base, text: "hello", referenceAudio: Uint8Array.of(1), targetDurationMs: 1000 };
  expectTypeOf(dispatch("deepdub", valid)).toEqualTypeOf<AsyncIterableIterator<Uint8Array>>();
  // @ts-expect-error Complete-text HTTP does not accept streaming text or controls.
  const streaming: TtsRequest = { ...base, text: text() };
  // @ts-expect-error The seed would be ignored by a modern model.
  const seed: TtsRequest = { ...base, text: "hello", randomSeed: 42 };
  // @ts-expect-error Speed and duration cannot both be set.
  const duration: TtsRequest = { ...base, text: "hello", speed: 1, targetDurationMs: 1000 };
  // @ts-expect-error One conditioning source is required, not necessarily a voice ID.
  const voice: TtsRequest = { model: "og-1.1", text: "hello", language: "en-US", output: { format: "mp3" } };
  // @ts-expect-error HTTP does not support WAV or PCM.
  const wav: TtsRequest = { ...base, text: "hello", output: { format: "wav" } };
  // @ts-expect-error No timestamp-producing HTTP operation is documented.
  const timing: TtsRequest = { ...base, text: "hello", timestampGranularity: "word" };
  // @ts-expect-error Scheduling priority is not a synthesis quality tradeoff.
  const latency: TtsRequest = { ...base, text: "hello", latencyOptimization: "aggressive" };
  // @ts-expect-error Accent blending is one cohesive triple.
  const accent: TtsRequest = { ...base, text: "hello", accentBlend: { baseLocale: "en-US", ratio: 0.2 } };
  // @ts-expect-error Dispatcher must retain the provider's seed restriction.
  dispatch("deepdub", { ...base, text: "hello", randomSeed: 3 });
  expectTypeOf<AmazonRequest["text"]>().toEqualTypeOf<string | AsyncIterable<string>>();
  expectTypeOf<typeof import("../amazon/index.ts").synthesize>().returns.toEqualTypeOf<AsyncIterableIterator<Uint8Array>>();
  // @ts-expect-error Broadening base resampling does not broaden Amazon's documented Opus rate.
  const amazonRate: AmazonRequest = { model: "standard", voice: "Joanna", text: "hello", output: { format: "ogg_opus", sampleRateHz: 16000 } };
  void [streaming, seed, duration, voice, wav, timing, latency, accent, amazonRate];
});

test("Deepdub bundles for browsers without Node shims or runtime dependencies", async () => {
  const result = await Bun.build({ entrypoints: [new URL("index.ts", import.meta.url).pathname], target: "browser" });
  expect(result.success).toBe(true); expect(await result.outputs[0]!.text()).not.toContain("node:");
});
