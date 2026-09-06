import { describe, expect, expectTypeOf, test } from "bun:test";
import { synthesize, ElevenLabsError, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import fixtures from "../../../sdks/fixtures/elevenlabs.json";

const base = { model: "flash-v2.5", voice: "custom/id", output: { format: "mp3" } } as const;
const auth = { elevenlabs: { apiKey: "test-key" } } as const;
async function* input(...values: Array<string | { readonly command: "clear" } | { readonly command: "flush" }>) { yield* values; }
class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = false;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  onSend: (value: Record<string, any>) => void = () => {};
  send(data: unknown) { const value = JSON.parse(String(data)); this.sent.push(value); this.onSend(value); }
  close() { this.closed = true; this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: any) => void) { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
}

describe("ElevenLabs HTTP", () => {
  test("shared HTTP fixtures match all model and normalized output mappings", async () => {
    for (const fixture of fixtures.http) {
      const request = fixture.request as TtsRequest;
      const values: unknown = await Array.fromAsync(synthesize(request, { auth,
        baseUrl: "https://proxy.invalid/p%20x?trace=1&seed=42&single_use_token=old&api_key=old&output_format=wav_8000&optimize_streaming_latency=4",
        fetch: async (url, init) => {
          const target = new URL(String(url));
          expect(target.pathname).toBe(`/p%20x${fixture.path}`);
          const query: Record<string, unknown> = Object.fromEntries([...new Set(target.searchParams.keys())].map(key => [key, target.searchParams.getAll(key)]));
          expect(query).toEqual({ trace: ["1"], ...fixture.query });
          expect(JSON.parse(String(init?.body))).toEqual(fixture.body);
          return request.timestampGranularity === undefined ? new Response(Uint8Array.of(0,255)) : Response.json({ audio_base64: "AP8=", alignment: fixtures.timing[0]!.alignment, normalized_alignment: fixtures.timing[0]!.alignment });
        },
      }));
      expect(values).toEqual(request.timestampGranularity === undefined ? [Uint8Array.of(0,255)] : [{ correlation: "chunk", audio: Uint8Array.of(0,255), timestamps: fixtures.timing[0]!.timestamps }]);
    }
  });
  test("rejects timing overflow after seconds-to-milliseconds conversion", async () => {
    await expect(synthesize({ ...base, text: "hi", timestampGranularity: "character" }, { auth, fetch: async () => Response.json({ audio_base64: "AQ==", alignment: { characters: ["x"], character_start_times_seconds: [1e308], character_end_times_seconds: [1e308] } }) }).next()).rejects.toEqual(new TypeError("ElevenLabs returned invalid character timing"));
  });
  test("streams native bytes before completion and preserves custom voice, proxy path and defaults", async () => {
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1)); finish = () => { controller.enqueue(Uint8Array.of(2)); controller.close(); }; } });
    const stream = synthesize({ ...base, text: "hello" }, { auth, baseUrl: "https://proxy.invalid/eleven/?tenant=one", fetch: async (url, init) => {
      const parsed = new URL(String(url)); expect(parsed.pathname).toBe("/eleven/v1/text-to-speech/custom%2Fid/stream");
      expect(parsed.searchParams.get("tenant")).toBe("one");
      expect(parsed.searchParams.get("output_format")).toBe("mp3_44100_128"); expect(parsed.searchParams.get("enable_logging")).toBe("true");
      expect(init?.headers).toEqual({ "xi-api-key": "test-key", "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({ text: "hello", model_id: "eleven_flash_v2_5", voice_settings: {}, apply_text_normalization: "auto", apply_language_text_normalization: false });
      return new Response(body);
    } });
    expect((await stream.next()).value).toEqual(Uint8Array.of(1)); finish(); expect((await stream.next()).value).toEqual(Uint8Array.of(2)); expect((await stream.next()).done).toBe(true);
  });
  test.each([{ model: "flash-v2" }, { model: "flash-v2.5" }, { model: "multilingual-v2" }, { model: "eleven-v3" }] as const)("maps model %j", async model => {
    const wire = ({ "flash-v2": "eleven_flash_v2", "flash-v2.5": "eleven_flash_v2_5", "multilingual-v2": "eleven_multilingual_v2", "eleven-v3": "eleven_v3" } as const)[model.model];
    await Array.fromAsync(synthesize({ ...base, ...model, text: "hi" }, { auth, fetch: async (_url, init) => { expect(JSON.parse(String(init?.body)).model_id).toBe(wire); return new Response(Uint8Array.of(1)); } }));
  });
  test("maps independent controls, dictionary versions, context and false values", async () => {
    await Array.fromAsync(synthesize({ ...base, text: "hello", language: "ja", stability: 0, voiceSimilarity: 0.2, styleExaggeration: 0.3, voiceBoost: false, speed: 0.7, randomSeed: 0, textNormalization: false, languageTextNormalization: true, pronunciationDictionaries: [{ id: "lex" }, { id: "lex2", versionId: "v2" }], contextBefore: { text: "Before" }, contextAfter: { requestIds: ["next"] } }, { auth, requestLogging: false, fetch: async (url, init) => {
      expect(new URL(String(url)).searchParams.get("enable_logging")).toBe("false");
      expect(JSON.parse(String(init?.body))).toEqual({ text: "hello", model_id: "eleven_flash_v2_5", language_code: "ja", voice_settings: { stability: 0, similarity_boost: 0.2, style: 0.3, use_speaker_boost: false, speed: 0.7 }, seed: 0, apply_text_normalization: "off", apply_language_text_normalization: true, pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: "lex" }, { pronunciation_dictionary_id: "lex2", version_id: "v2" }], previous_text: "Before", next_request_ids: ["next"] });
      return new Response(Uint8Array.of(1));
    } }));
  });
  test.each(["none", "moderate", "strong", "aggressive"] as const)("preserves legacy latency level %s", async latencyOptimization => {
    await Array.fromAsync(synthesize({ ...base, text: "hello", latencyOptimization }, { auth, fetch: async (url, init) => {
      expect(new URL(String(url)).searchParams.get("optimize_streaming_latency")).toBe(String(["none", "moderate", "strong", "aggressive"].indexOf(latencyOptimization)));
      expect(JSON.parse(String(init?.body)).apply_text_normalization).toBe("auto"); return new Response(Uint8Array.of(1));
    } }));
  });
  test("maximum legacy latency optimization disables normalization even when omitted", async () => {
    await Array.fromAsync(synthesize({ ...base, text: "hello", latencyOptimization: "maximum" }, { auth, fetch: async (url, init) => {
      expect(new URL(String(url)).searchParams.get("optimize_streaming_latency")).toBe("4");
      expect(JSON.parse(String(init?.body)).apply_text_normalization).toBe("off"); return new Response(Uint8Array.of(1));
    } }));
  });
  test("uses ordinary HTTP for WAV without inventing a buffering operation", async () => {
    for (const timestampGranularity of [undefined, "character"] as const) {
      const request: TtsRequest = timestampGranularity ? { ...base, text: "hello", output: { format: "wav", sampleRateHz: 24000 }, timestampGranularity } : { ...base, text: "hello", output: { format: "wav", sampleRateHz: 24000 } };
      const chunks = await Array.fromAsync(synthesize(request, { auth, fetch: async url => {
        expect(new URL(String(url)).pathname).toBe(`/v1/text-to-speech/custom%2Fid${timestampGranularity ? "/with-timestamps" : ""}`);
        expect(new URL(String(url)).searchParams.get("output_format")).toBe("wav_24000");
        return new Response(timestampGranularity ? JSON.stringify({ audio_base64: "AQI=" }) : Uint8Array.of(1, 2));
      } }));
      expect(chunks).toEqual(timestampGranularity ? [{ correlation: "chunk", audio: Uint8Array.of(1, 2), timestamps: [] }] : [Uint8Array.of(1, 2)]);
    }
  });
  test("keeps NDJSON audio and original/normalized character timing in the same native chunk", async () => {
    for (const timestampText of ["original", "normalized"] as const) {
      const alignment = { characters: ["é"], character_start_times_seconds: [0.1], character_end_times_seconds: [0.2] };
      const packet = JSON.stringify({ audio_base64: "AQI=", alignment, normalized_alignment: { ...alignment, characters: ["e"] } });
      const bytes = new TextEncoder().encode(`${packet}\r\n${JSON.stringify({ audio_base64: "Aw==" })}`);
      const chunks = await Array.fromAsync(synthesize({ ...base, text: "é", timestampGranularity: "character", timestampText }, { auth, fetch: async url => {
        expect(new URL(String(url)).pathname).toBe("/v1/text-to-speech/custom%2Fid/stream/with-timestamps");
        return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
      } }));
      expect(chunks).toEqual([{ correlation: "chunk", audio: Uint8Array.of(1, 2), timestamps: [{ kind: "character", value: timestampText === "original" ? "é" : "e", startTimeMs: 100, endTimeMs: 200 }] }, { correlation: "chunk", audio: Uint8Array.of(3), timestamps: [] }]);
    }
  });
  test("retains error identity and never retries billable synthesis", async () => {
    let calls = 0;
    const stream = synthesize({ ...base, text: "hello" }, { auth, fetch: async () => { calls++; return new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "Out of credits" } }), { status: 429, headers: { "request-id": "trace" } }); } });
    try { await stream.next(); throw new Error("expected failure"); } catch (error) { expect(error).toBeInstanceOf(ElevenLabsError); expect(error).toMatchObject({ statusCode: 429, errorCode: "quota_exceeded", requestId: "trace" }); }
    expect(calls).toBe(1);
  });
  test("cancels response body on consumer exit and avoids fetch on pre-abort", async () => {
    let cancelled = false;
    const stream = synthesize({ ...base, text: "hello" }, { auth, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; } })) });
    await stream.next(); await stream.return?.(); expect(cancelled).toBe(true);
    await expect(synthesize({ ...base, text: "hi" }, { auth, signal: AbortSignal.abort(new Error("stop")), fetch: async () => { throw new Error("must not fetch"); } }).next()).rejects.toThrow("stop");
  });
  test("resolves shared auth before Speechswitch and provider environment variables", async () => {
    const previous = [process.env.SPEECHSWITCH_ELEVENLABS_API_KEY, process.env.ELEVENLABS_API_KEY];
    try {
      process.env.SPEECHSWITCH_ELEVENLABS_API_KEY = "speechswitch-key"; process.env.ELEVENLABS_API_KEY = "provider-key";
      for (const expected of ["test-key", "speechswitch-key", "provider-key"]) {
        if (expected === "provider-key") delete process.env.SPEECHSWITCH_ELEVENLABS_API_KEY;
        await Array.fromAsync(synthesize({ ...base, text: "hi" }, { auth: expected === "test-key" ? auth : undefined, fetch: async (_url, init) => {
          expect(new Headers(init?.headers).get("xi-api-key")).toBe(expected); return new Response(Uint8Array.of(1));
        } }));
      }
      delete process.env.ELEVENLABS_API_KEY;
      await expect(synthesize({ ...base, text: "hi" }).next()).rejects.toThrow("Missing auth.elevenlabs.apiKey");
    } finally {
      if (previous[0] === undefined) delete process.env.SPEECHSWITCH_ELEVENLABS_API_KEY; else process.env.SPEECHSWITCH_ELEVENLABS_API_KEY = previous[0];
      if (previous[1] === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = previous[1];
    }
  });
  test("covers every cataloged ordinary HTTP output encoding", async () => {
    const openapi = await Bun.file(import.meta.dir + "/../../../schemas/sources/elevenlabs/00-openapi.json").json();
    const formats: string[] = openapi.paths["/v1/text-to-speech/{voice_id}"].post.parameters.find((value: { name: string }) => value.name === "output_format").schema.enum;
    for (const wire of formats) {
      const [codec, rate, bits] = wire.split("_");
      const output = { format: codec === "ulaw" ? "mulaw" : codec === "opus" ? "ogg_opus" : codec, sampleRateHz: Number(rate), ...(bits === undefined ? {} : { bitRateBps: Number(bits) * 1000 }) };
      await Array.fromAsync(synthesize({ ...base, text: "hi", output } as TtsRequest, { auth, fetch: async url => {
        expect(new URL(String(url)).searchParams.get("output_format")).toBe(wire); return new Response(Uint8Array.of(1));
      } }));
    }
    expect(formats).toHaveLength(28);
  });
});

describe("ElevenLabs WebSockets", () => {
  test.each(["camel", "snake"] as const)("clear rejects stale %s-case context audio and drains final audio", async casing => {
    const socket = new Socket(); let old = ""; let current = ""; let resume!: () => void;
    const next = new Promise<void>(resolve => { resume = resolve; });
    async function* text() { yield "old"; await next; yield { command: "clear" } as const; yield "new"; yield { command: "flush" } as const; }
    const reply = (id: string, value: object) => socket.receive({ [casing === "camel" ? "contextId" : "context_id"]: id, ...value });
    socket.onSend = value => {
      if (value.voice_settings) { current = value.context_id; expect(value.xi_api_key).toBe("test-key"); }
      if (value.text === "old") { old = current; reply(current, { audio: "AQ==" }); }
      if (value.close_context) { expect(value.context_id).toBe(old); reply(old, { audio: "CQ==" }); reply(old, { error: "context_closed", message: "retired context", code: 1008 }); reply(old, { isFinal: true }); }
      if (value.text === "new") { expect(current).not.toBe(old); reply(current, { audio: "Ag==" }); }
      if (value.close_socket) reply(current, { audio: "Aw==", [casing === "camel" ? "isFinal" : "is_final"]: true });
    };
    const stream = synthesize({ ...base, text: text() }, { auth, webSocket: socket });
    expect((await stream.next()).value).toEqual(Uint8Array.of(1)); resume();
    expect((await stream.next()).value).toEqual({ event: "clear" }); expect((await stream.next()).value).toEqual(Uint8Array.of(2));
    expect((await stream.next()).value).toEqual(Uint8Array.of(3)); expect((await stream.next()).done).toBe(true);
    expect(socket.sent.some(value => value.flush)).toBe(true); expect(socket.closed).toBe(true);
  });
  test("preserves streamed token spelling and per-chunk character offsets", async () => {
    const socket = new Socket(); let contextId = "";
    socket.onSend = value => {
      if (value.voice_settings) contextId = value.context_id;
      if (value.text === "lo") socket.receive({ contextId, audio: "AQ==", normalizedAlignment: { chars: ["H"], charStartTimesMs: [0], charDurationsMs: [20] } });
      if (value.close_socket) socket.receive({ contextId, isFinal: true });
    };
    const values = await Array.fromAsync(synthesize({ ...base, text: input("Hel", "lo"), timestampGranularity: "character", timestampText: "normalized", textBufferThresholds: [50, 100] }, { auth, webSocket: socket }));
    expect(socket.sent[0]?.generation_config).toEqual({ chunk_length_schedule: [50, 100] });
    expect(socket.sent.filter(value => value.text === "Hel" || value.text === "lo").map(value => value.text)).toEqual(["Hel", "lo"]);
    expect(values).toEqual([{ correlation: "chunk", audio: Uint8Array.of(1), timestamps: [{ kind: "character", value: "H", startTimeMs: 0, endTimeMs: 20 }] }]);
  });
  test("v3 initializes voices, uses inputs and flush, and reads snake-case timing/final messages", async () => {
    const socket = new Socket();
    socket.onSend = value => {
      if (value.voices) expect(value).toEqual({ voices: ["custom/id"], xi_api_key: "test-key", voice_settings: { stability: 0.5 } });
      if (value.inputs) { expect(value.inputs).toEqual([{ text: "Hello", voice_id: "custom/id" }]); socket.receive({ audio: "AQ==", alignment: { chars: ["H"], char_start_times_ms: [5], char_durations_ms: [10] } }); socket.receive({ is_final_audio_for_turn: true }); }
      if (value.close_socket) socket.receive({ audio: "Ag==", is_final: true });
    };
    async function* text() { yield "Hello"; yield { command: "flush" } as const; }
    const result = await Array.fromAsync(synthesize({ ...base, model: "eleven-v3", text: text(), stability: 0.5, timestampGranularity: "character" }, { auth, webSocket: socket }));
    expect(result).toEqual([{ correlation: "chunk", audio: Uint8Array.of(1), timestamps: [{ kind: "character", value: "H", startTimeMs: 5, endTimeMs: 15 }] }, { correlation: "chunk", audio: Uint8Array.of(2), timestamps: [] }]);
    expect(socket.sent).toEqual([
      { voices: ["custom/id"], xi_api_key: "test-key", voice_settings: { stability: 0.5 } },
      { inputs: [{ text: "Hello", voice_id: "custom/id" }] }, { flush: true }, { close_socket: true },
    ]);
    expect(socket.closed).toBe(true);
  });
  test("fails early closure and malformed messages, and releases the input iterator", async () => {
    for (const failure of ["close", "alignment", "context", "error"] as const) {
      const socket = new Socket(); let returned = false;
      const text = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<string>>(() => {}), return: async () => { returned = true; return { done: true as const, value: undefined }; } }; } };
      socket.onSend = value => { queueMicrotask(() => {
        if (failure === "close") socket.close();
        if (failure === "context") socket.receive({ audio: "AQ==" });
        if (failure === "alignment") socket.receive({ context_id: value.context_id, audio: "AQ==", alignment: { chars: ["x"], charStartTimesMs: [], charDurationsMs: [] } });
        if (failure === "error") socket.receive({ error: "invalid_request", message: "Bad request", code: 1008 });
      }); };
      await expect(synthesize({ ...base, text, timestampGranularity: "character" }, { auth, webSocket: socket }).next()).rejects.toThrow();
      expect(returned).toBe(true); expect(socket.closed).toBe(true);
    }
  });
  test("abort and consumer exit release a stalled input and detach listeners", async () => {
    for (const abort of [true, false]) {
      const socket = new Socket(); let returned = false; let first = true;
      const text = { [Symbol.asyncIterator]() { return { next: () => first ? (first = false, Promise.resolve({ done: false as const, value: "hello" })) : new Promise<IteratorResult<string>>(() => {}), return: async () => { returned = true; return { done: true as const, value: undefined }; } }; } };
      socket.onSend = value => { if (value.text === "hello") socket.receive({ context_id: value.context_id, audio: "AQ==" }); };
      const controller = new AbortController(); const stream = synthesize({ ...base, text }, { auth, webSocket: socket, signal: controller.signal });
      expect((await stream.next()).value).toEqual(Uint8Array.of(1));
      if (abort) { const pending = stream.next(); controller.abort(new Error("barge in")); await expect(pending).rejects.toThrow("barge in"); } else await stream.return?.();
      expect(returned).toBe(true); expect(socket.closed).toBe(true); expect([...socket.listeners.values()].every(value => value.size === 0)).toBe(true);
    }
  });
  test("a deadline cancels opening the socket and acquiring a throwing iterator cleans up", async () => {
    const opening = new Socket(); opening.readyState = 0;
    await expect(synthesize({ ...base, text: input("hello") }, { auth, webSocket: opening, timeoutMs: 20 }).next()).rejects.toThrow();
    expect(opening.closed).toBe(true);
    const socket = new Socket();
    const text = { [Symbol.asyncIterator](): AsyncIterator<string> { throw new Error("cannot acquire source"); } };
    await expect(synthesize({ ...base, text }, { auth, webSocket: socket }).next()).rejects.toThrow("cannot acquire source");
    expect(socket.closed).toBe(true);
  });
  test("rejects HTTP-only and conflicting streaming controls before opening a socket", async () => {
    for (const changes of [
      { output: { format: "wav", sampleRateHz: 24000 } }, { contextBefore: { text: "before" } }, { languageTextNormalization: true }, { latencyOptimization: "moderate" },
      { pronunciationDictionaries: [{ id: "dict" }] }, { model: "eleven-v3", textBuffering: false }, { model: "eleven-v3", timestampGranularity: "character", timestampText: "normalized" },
      { textBufferThresholds: [50], textBuffering: false },
    ]) {
      const socket = new Socket();
      await expect(synthesize({ ...base, text: input("hello"), ...changes } as unknown as TtsRequest, { auth, webSocket: socket }).next()).rejects.toEqual(new TypeError("Invalid elevenlabs TTS request"));
      expect(socket.sent).toEqual([]);
    }
  });
});

test.each([
  { model: "unknown" }, { voice: "" }, { model: "multilingual-v2", language: "en" }, { model: "eleven-v3", speed: 1 }, { speed: 5 }, { stability: -1 }, { voiceSimilarity: 2 }, { randomSeed: -1 }, { randomSeed: 4294967296 },
  { output: { format: "mp3", sampleRateHz: 22050, bitRateBps: 128000 } }, { output: { format: "mulaw", sampleRateHz: 24000 } }, { output: { format: "pcm", sampleRateHz: 24000, sampleEncoding: "float_32" } },
  { output: { format: "mp3", sampleEncoding: "float_32" } },
  { contextBefore: { text: "before", requestIds: ["id"] } }, { pronunciationDictionaries: [{ id: "" }] }, { timestampGranularity: "word" }, { textNormalization: { locale: "en" } }, { latencyOptimization: "maximum", textNormalization: true },
])("rejects invalid JavaScript input before billing: %j", async changes => {
  let called = false;
  await expect(synthesize({ ...base, text: "hello", ...changes } as unknown as TtsRequest, { auth, fetch: async () => { called = true; return new Response(); } }).next()).rejects.toEqual(new TypeError("Invalid elevenlabs TTS request"));
  expect(called).toBe(false);
});

test("provider types reject unsupported combinations without widening Amazon", () => {
  const text = input("hello");
  const valid: TtsRequest = { ...base, text, textBuffering: false }; void valid;
  // @ts-expect-error WAV does not support streaming input.
  const wav: TtsRequest = { ...base, text, output: { format: "wav", sampleRateHz: 24000 } }; void wav;
  // @ts-expect-error V3 has no clear command on its dialogue connection.
  const v3: TtsRequest = { ...base, model: "eleven-v3", text }; void v3;
  // @ts-expect-error V3 has no speed voice setting.
  const speed: TtsRequest = { ...base, model: "eleven-v3", text: "hi", speed: 1 }; void speed;
  // @ts-expect-error Wrong MP3 sample-rate/bit-rate combination.
  const mp3: TtsRequest = { ...base, text: "hi", output: { format: "mp3", sampleRateHz: 22050, bitRateBps: 192000 } }; void mp3;
  // @ts-expect-error WebSockets require pinned pronunciation dictionary versions.
  const dictionary: TtsRequest = { ...base, text, pronunciationDictionaries: [{ id: "dict" }] }; void dictionary;
  // @ts-expect-error Cannot disable buffering and supply thresholds simultaneously.
  const buffering: TtsRequest = { ...base, text, textBuffering: false, textBufferThresholds: [50] }; void buffering;
  // @ts-expect-error Maximum legacy latency optimization turns normalization off.
  const normalization: TtsRequest = { ...base, text: "hi", latencyOptimization: "maximum", textNormalization: true }; void normalization;
  // @ts-expect-error Context text would be ignored when request IDs are present.
  const context: TtsRequest = { ...base, text: "hi", contextBefore: { text: "before", requestIds: ["id"] } }; void context;
  // @ts-expect-error Multilingual v2 does not accept an explicit language.
  const language: TtsRequest = { ...base, model: "multilingual-v2", text: "hi", language: "en" }; void language;
  // @ts-expect-error Existing voice selection is required; cloning is a separate operation.
  const reference: TtsRequest = { model: "eleven-v3", text: "hi", referenceAudio: Uint8Array.of(1), output: { format: "mp3" } }; void reference;
  expectTypeOf(dispatch("amazon", { text: "hi", voice: "Joanna", output: { format: "mp3" } })).toMatchTypeOf<AsyncIterable<Uint8Array>>();
  // @ts-expect-error Amazon streaming input remains string-only.
  dispatch("amazon", { text, voice: "Joanna", output: { format: "mp3" } });
});

test("ElevenLabs bundles for browsers without Node runtime dependencies", async () => {
  const build = await Bun.build({ entrypoints: [import.meta.dir + "/index.ts"], target: "browser" });
  expect(build.success).toBe(true);
  for (const file of build.outputs) expect(new Bun.Transpiler({ loader: "js" }).scanImports(await file.text())).toEqual([]);
});

test.each([
  ["fractional random seed", { randomSeed: 0.5 }],
  ["too many context IDs", { contextAfter: { requestIds: ["1", "2", "3", "4"] } }],
  ["empty context IDs", { contextBefore: { requestIds: [] } }],
  ["too many dictionaries", { pronunciationDictionaries: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }] }],
] as const)("generated schema validation rejects %s before transport", async (_name, changes) => {
  let called = false;
  await expect(synthesize({ ...base, text: "hello", ...changes }, { auth, fetch: async () => { called = true; return new Response(); } }).next()).rejects.toEqual(new TypeError("Invalid elevenlabs TTS request"));
  expect(called).toBe(false);
});

test.each([{ textBufferThresholds: [] }, { textBufferThresholds: [49] }, { textBufferThresholds: [501] }, { textBufferThresholds: [50.5] }])("rejects invalid integer buffering schedule %j before the handshake", async ({ textBufferThresholds }) => {
  const socket = new Socket();
  await expect(synthesize({ ...base, text: input("hello"), textBufferThresholds }, { auth, webSocket: socket }).next())
    .rejects.toEqual(new TypeError("Invalid elevenlabs TTS request"));
  expect(socket.sent).toEqual([]);
});

test("v3 rejects clear at consumption and releases its input", async () => {
  const socket = new Socket(); let returned = false;
  async function* text() { try { yield { command: "clear" } as const; } finally { returned = true; } }
  // @ts-expect-error V3 dialogue supports flush, but not TTS context cancellation.
  const request: TtsRequest = { ...base, model: "eleven-v3", text: text() };
  await expect(synthesize(request, { auth, webSocket: socket }).next()).rejects.toEqual(new TypeError("Invalid elevenlabs TTS input item"));
  expect(socket.sent).toEqual([{ voices: ["custom/id"], xi_api_key: "test-key", voice_settings: {} }]);
  expect(returned).toBe(true); expect(socket.closed).toBe(true);
});

test("dialogue rejects a malformed turn-final flag even on an audio packet", async () => {
  const socket = new Socket();
  socket.onSend = () => socket.receive({ audio: "AQ==", is_final_audio_for_turn: "true" });
  async function* text() { yield "hello"; }
  await expect(synthesize({ ...base, model: "eleven-v3", text: text() }, { auth, webSocket: socket }).next())
    .rejects.toEqual(new TypeError("Invalid ElevenLabs turn-final flag"));
  expect(socket.closed).toBe(true);
});

test("rejects a deadline that the runtime would overflow before opening a socket", async () => {
  const socket = new Socket();
  await expect(synthesize({ ...base, text: input("hello") }, { auth, webSocket: socket, timeoutMs: 2147483648 }).next())
    .rejects.toEqual(new TypeError("ElevenLabs timeoutMs must be an integer between 1 and 2147483647"));
  expect(socket.sent).toEqual([]);
});
