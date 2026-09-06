import { expect, test } from "bun:test";
import { synthesize, TypecastError, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import { validateRequest } from "../../generated/validators/typecast.ts";

const auth = { typecast: { apiKey: "test-key" } };
const request = { model: "ssfm-v30", voice: "uc_custom", text: "Hello" } as const;
const wire = { voice_id: "uc_custom", text: "Hello", model: "ssfm-v30", prompt: { emotion_type: "preset", emotion_preset: "normal", emotion_intensity: 1 }, output: { audio_format: "wav", audio_pitch: 0, audio_tempo: 1 } };
const timestamps = { audio: "AP+A", audio_format: "wav", audio_duration: 1,
  words: [{ text: "Hello!", start: 0, end: 0.5 }], characters: [{ text: "H", start: 0, end: 0.1 }, { text: " ", start: 0.1, end: 0.2 }] };

test("default synthesis uses byte-native streaming without attribution telemetry", async () => {
  const result = await Array.fromAsync(dispatch("typecast", request, { auth, baseUrl: "https://example.test/proxy?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://example.test/proxy/v1/text-to-speech/stream?tenant=one");
    expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ "X-API-KEY": "test-key", "Content-Type": "application/json", Accept: "audio/wav" });
    expect(JSON.parse(String(init?.body))).toEqual(wire);
    return new Response(Uint8Array.of(0, 255, 128), { headers: { "content-type": "audio/wav" } });
  } }));
  expect(result).toEqual([Uint8Array.of(0, 255, 128), { event: "done" }]);
});

test.each([
  [{ ...request, model: "ssfm-v21", emotion: "sad", emotionIntensity: 0, language: "ko", randomSeed: 0 },
    { ...wire, model: "ssfm-v21", language: "kor", seed: 0, prompt: { emotion_preset: "sad", emotion_intensity: 0 } }],
  [{ ...request, emotion: "whisper", emotionIntensity: 2, language: "hi", speed: 0.5, pitchSemitones: -12 },
    { ...wire, language: "hin", prompt: { emotion_type: "preset", emotion_preset: "whisper", emotion_intensity: 2 }, output: { audio_format: "wav", audio_pitch: -12, audio_tempo: 0.5 } }],
  [{ ...request, emotion: "auto", contextBefore: { text: "Before" }, contextAfter: { text: "" }, language: "yue" },
    { ...wire, language: "yue", prompt: { emotion_type: "smart", previous_text: "Before", next_text: "" } }],
] as const)("model-aware controls produce exact native payload %#", async (value, expected) => {
  await Array.fromAsync(synthesize(value, { auth, fetch: async (_url, init) => { expect(JSON.parse(String(init?.body))).toEqual(expected); return new Response(Uint8Array.of(1)); } }));
});

test("relative volume selects ordinary synthesis and rounds one-percent steps without dropping zero", async () => {
  for (const [volumeScale, volume] of [[0, 0], [0.29, 29], [0.005, 1], [2, 200]] as const) {
    await Array.fromAsync(synthesize({ ...request, volumeScale }, { auth, fetch: async (url, init) => {
      expect(String(url)).toBe("https://api.typecast.ai/v1/text-to-speech");
      expect(JSON.parse(String(init?.body))).toEqual({ ...wire, output: { ...wire.output, volume } });
      return new Response(Uint8Array.of(1));
    } }));
  }
});

test.each([[32000, "stream"], [44100, ""]] as const)("WAV at %i Hz selects its native endpoint", async (sampleRateHz, endpoint) => {
  await Array.fromAsync(synthesize({ ...request, output: { format: "wav", sampleRateHz }, targetLoudnessLufs: 0 }, { auth, fetch: async (url, init) => {
    expect(String(url)).toBe(`https://api.typecast.ai/v1/text-to-speech${endpoint ? "/stream" : ""}`);
    expect(JSON.parse(String(init?.body))).toEqual({ ...wire, output: { ...wire.output, target_lufs: 0 } });
    return new Response(Uint8Array.of(1));
  } }));
});

test("MP3 uses native fixed bitrate and streams MPEG bytes, not base64", async () => {
  await Array.fromAsync(synthesize({ ...request, output: { format: "mp3", bitRateBps: 320000, sampleRateHz: 44100 } }, { auth, fetch: async (url, init) => {
    expect(String(url)).toBe("https://api.typecast.ai/v1/text-to-speech/stream");
    expect(init?.headers).toEqual({ "X-API-KEY": "test-key", "Content-Type": "application/json", Accept: "audio/mpeg" });
    expect(JSON.parse(String(init?.body))).toEqual({ ...wire, output: { ...wire.output, audio_format: "mp3" } });
    return new Response(Uint8Array.of(1), { headers: { "content-type": "audio/mpeg" } });
  } }));
});

test("consumer sees the first raw chunk before EOF and return releases the reader", async () => {
  let canceled = 0;
  const stream = synthesize(request, { auth, fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.of(82, 73, 70, 70)); }, cancel() { canceled++; },
  })) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(82, 73, 70, 70) });
  await stream.return?.(); expect(canceled).toBe(1);
});

test.each([{ timestampGranularity: "word" }, { timestampGranularity: "character" }, { timestampGranularity: ["word", "character"] }] as const)("timestamp selection %# retains one native audio/alignment envelope", async ({ timestampGranularity }) => {
  const words = timestampGranularity !== "character"; const characters = timestampGranularity !== "word";
  const result = await Array.fromAsync(synthesize({ ...request, timestampGranularity }, { auth, baseUrl: "https://example.test?tenant=one&granularity=stale", fetch: async (url, init) => {
    expect(String(url)).toBe(`https://example.test/v1/text-to-speech/with-timestamps?tenant=one${words !== characters ? `&granularity=${words ? "word" : "char"}` : ""}`);
    expect(init?.headers).toEqual({ "X-API-KEY": "test-key", "Content-Type": "application/json", Accept: "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual(wire);
    return Response.json({ ...timestamps, words: words ? timestamps.words : null, characters: characters ? timestamps.characters : null });
  } }));
  expect(result).toEqual([{ correlation: "chunk", audio: Uint8Array.of(0, 255, 128), durationMs: 1000, timestamps: [
    ...(words ? [{ kind: "word" as const, value: "Hello!", startTimeMs: 0, endTimeMs: 500 }] : []),
    ...(characters ? [{ kind: "character" as const, value: "H", startTimeMs: 0, endTimeMs: 100 }, { kind: "character" as const, value: " ", startTimeMs: 100, endTimeMs: 200 }] : []),
  ] }, { event: "done" }]);
});

test("empty timestamp selection disables alignment while retaining ordinary audio defaults", async () => {
  await Array.fromAsync(synthesize({ ...request, timestampGranularity: [] }, { auth, fetch: async url => {
    expect(String(url)).toBe("https://api.typecast.ai/v1/text-to-speech"); return new Response(Uint8Array.of(1));
  } }));
});

test("compose preserves ordered pauses and per-segment model controls with one shared format", async () => {
  const result = await Array.fromAsync(synthesize({ output: { format: "mp3" }, segments: [
    { kind: "pause", pauseMs: 0.5 },
    { kind: "speech", model: "ssfm-v21", text: "One", voice: "tc_builtin", language: "ko", emotion: "happy", emotionIntensity: 0, volumeScale: 0, randomSeed: 0 },
    { kind: "pause", pauseMs: 10000 },
    { kind: "speech", model: "ssfm-v30", text: "Two", voice: "uc_clone", emotion: "auto", contextAfter: { text: "Next" }, targetLoudnessLufs: -14 },
  ] }, { auth, fetch: async (url, init) => {
    expect(String(url)).toBe("https://api.typecast.ai/v1/text-to-speech/compose");
    expect(JSON.parse(String(init?.body))).toEqual({ segments: [
      { type: "pause", duration_seconds: 0.0005 },
      { type: "tts", voice_id: "tc_builtin", text: "One", model: "ssfm-v21", language: "kor", seed: 0,
        prompt: { emotion_preset: "happy", emotion_intensity: 0 }, output: { audio_format: "mp3", audio_pitch: 0, audio_tempo: 1, volume: 0 } },
      { type: "pause", duration_seconds: 10 },
      { type: "tts", voice_id: "uc_clone", text: "Two", model: "ssfm-v30", prompt: { emotion_type: "smart", previous_text: "", next_text: "Next" },
        output: { audio_format: "mp3", audio_pitch: 0, audio_tempo: 1, target_lufs: -14 } },
    ] });
    return new Response(Uint8Array.of(1, 2));
  } }));
  expect(result).toEqual([Uint8Array.of(1, 2), { event: "done" }]);
});

const invalidAggregates: readonly TtsRequest[] = [
  { segments: [{ kind: "pause", pauseMs: 1 }] },
  { segments: [{ kind: "speech", ...request, text: "x".repeat(2000) }, { kind: "speech", ...request, text: "y" }] },
  { segments: [{ kind: "speech", ...request }, ...Array.from({ length: 7 }, () => ({ kind: "pause", pauseMs: 10000 }) as const)] },
];
test.each([...invalidAggregates])("composition aggregate constraints fail before network %#", async value => {
  await expect(synthesize(value, { auth }).next()).rejects.toEqual(new TypeError("Typecast composition requires speech, at most 2000 total text code points and at most 60000 ms total pauses"));
});

test.each([
  { model: "ssfm-v21", emotion: "whisper" }, { model: "ssfm-v21", language: "hi" }, { model: "ssfm-v21", emotion: "auto" },
  { emotion: "auto", emotionIntensity: 1 }, { contextBefore: { text: "context" } }, { emotion: "auto", contextBefore: { text: "a".repeat(2001) } },
  { volumeScale: 1, targetLoudnessLufs: -14 }, { volumeScale: 3 }, { targetLoudnessLufs: 0.1 }, { pitchSemitones: 0.5 },
  { randomSeed: -1 }, { randomSeed: 4294967296 }, { randomSeed: NaN }, { text: "" }, { text: "a".repeat(2001) },
  { text: (async function* () { yield "Hi"; })() }, { voice: "no_prefix" }, { output: { format: "pcm" } },
  { timestampGranularity: "word", output: { format: "wav", sampleRateHz: 32000 } }, { volumeScale: 0, output: { format: "wav", sampleRateHz: 32000 } },
  { output: { format: "mp3", bitRateBps: 128000 } },
])("generated schema rejects invalid model/format/control states %#", patch => {
  expect(() => validateRequest({ ...request, ...patch })).toThrow(new TypeError("Invalid typecast TTS request"));
});

test("generated composition validators enforce counts, variants and sparse-element rejection", () => {
  const speech = { kind: "speech", ...request };
  for (const segments of [[], Array.from({ length: 51 }, () => speech), Array(1), [{ kind: "pause", pauseMs: 0 }], [{ ...speech, model: "ssfm-v21", emotion: "whisper" }], [{ ...speech, output: { format: "mp3" } }]]) {
    expect(() => validateRequest({ segments })).toThrow(new TypeError("Invalid typecast TTS request"));
  }
  expect(validateRequest({ segments: Array.from({ length: 50 }, () => speech) })).toBeTypeOf("function");
  expect(() => validateRequest({ segments: [speech], text: "also text" })).toThrow(new TypeError("Invalid typecast TTS request"));
});

test.each([
  [{ audio: "AR==" }, "Invalid Typecast base64 audio"], [{ audio: "" }, "Invalid Typecast base64 audio"],
  [{ audio_format: "mp3" }, "Invalid Typecast timestamp audio metadata"], [{ audio_duration: -1 }, "Invalid Typecast timestamp audio metadata"],
  [{ words: null }, "Typecast omitted words alignment"], [{ words: [{ text: "x", start: 1, end: 0 }] }, "Invalid Typecast alignment interval"],
  [{ words: [null] }, "Invalid Typecast alignment segment"],
] as const)("timestamp protocol checks reject malformed responses %#", async (patch, message) => {
  await expect(synthesize({ ...request, timestampGranularity: "word" }, { auth, fetch: async () => Response.json({ ...timestamps, characters: null, ...patch }) }).next()).rejects.toEqual(new TypeError(message));
});

test("timestamp JSON size limits release the response before parsing", async () => {
  let canceled = 0;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(123, 32)); }, cancel() { canceled++; } }), { headers: { "content-type": "application/json" } });
  await expect(synthesize({ ...request, timestampGranularity: "word" }, { auth, maxTimestampResponseBytes: 1, fetch: async () => response }).next()).rejects.toEqual(new TypeError("Typecast timestamp response exceeds maxTimestampResponseBytes"));
  expect(canceled).toBe(1);
});

test("non-2xx errors never consume or expose upstream bodies", async () => {
  let read = 0; let canceled = 0;
  await expect(synthesize(request, { auth, fetch: async () => new Response(new ReadableStream({ pull() { read++; }, cancel() { canceled++; } }, { highWaterMark: 0 }), { status: 429 }) }).next()).rejects.toEqual(new TypecastError(429));
  expect(read).toBe(0); expect(canceled).toBe(1);
});

test("abort before headers reclaims a late response; abort after audio prevents done", async () => {
  const controller = new AbortController(); const gate = Promise.withResolvers<Response>(); let canceled = 0;
  const pending = synthesize(request, { auth, signal: controller.signal, fetch: () => gate.promise }).next();
  controller.abort(new Error("stop")); await expect(pending).rejects.toEqual(new Error("stop"));
  gate.resolve(new Response(new ReadableStream({ cancel() { canceled++; } }))); await Promise.resolve(); await Promise.resolve(); expect(canceled).toBe(1);
  const second = new AbortController(); const stream = synthesize(request, { auth, signal: second.signal, fetch: async () => new Response(Uint8Array.of(1)) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  second.abort(new Error("stop audio")); await expect(stream.next()).rejects.toEqual(new Error("stop audio"));
});

test("transport overrides cannot silently change the requested rate or discard controls", async () => {
  await expect(synthesize({ ...request, volumeScale: 1 }, { auth, transport: "stream" }).next()).rejects.toEqual(new TypeError("Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis"));
  await expect(synthesize({ ...request, output: { format: "wav", sampleRateHz: 32000 } }, { auth, transport: "http" }).next()).rejects.toEqual(new TypeError("Typecast ordinary WAV uses 44100 Hz, not 32000 Hz"));
  await expect(synthesize(request, { auth, timeoutMs: 0 }).next()).rejects.toEqual(new DOMException("Typecast synthesis deadline expired", "TimeoutError"));
});

test("pause unit conversion rejects underflow instead of transmitting a zero-duration pause", async () => {
  await expect(synthesize({ segments: [{ kind: "speech", ...request }, { kind: "pause", pauseMs: Number.MIN_VALUE }] }, { auth }).next()).rejects.toEqual(new TypeError("Typecast pause cannot be represented as positive seconds"));
});

test.each([
  [new Response(null, { status: 204 }), "Typecast returned no audio body"],
  [new Response(Uint8Array.of()), "Typecast returned no audio"],
  [Response.json({ error: "not audio" }), "Typecast returned an unexpected content type"],
  [new Response(Uint8Array.of(1), { headers: { "content-type": "audio/mpeg" } }), "Typecast returned an unexpected content type"],
] as const)("invalid raw audio response %# is rejected", async (response, message) => {
  await expect(Array.fromAsync(synthesize(request, { auth, fetch: async () => response }))).rejects.toEqual(new TypeError(message));
});

test("deadline interrupts uncooperative fetch and read waits", async () => {
  await expect(synthesize(request, { auth, timeoutMs: 5, fetch: () => new Promise<Response>(() => {}) }).next()).rejects.toEqual(new DOMException("Typecast synthesis deadline expired", "TimeoutError"));
  let canceled = 0;
  await expect(synthesize(request, { auth, timeoutMs: 5, fetch: async () => new Response(new ReadableStream({ cancel() { canceled++; } })) }).next()).rejects.toEqual(new DOMException("Typecast synthesis deadline expired", "TimeoutError"));
  expect(canceled).toBe(1);
});

test("abort after a timestamp envelope never emits done", async () => {
  const controller = new AbortController();
  const stream = synthesize({ ...request, timestampGranularity: ["word", "character"] }, { auth, signal: controller.signal, fetch: async () => Response.json(timestamps) });
  const first = await stream.next(); expect(first.done).toBe(false);
  controller.abort(new Error("stop alignment")); await expect(stream.next()).rejects.toEqual(new Error("stop alignment"));
});
