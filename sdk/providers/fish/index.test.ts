import { expect, expectTypeOf, test } from "bun:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { validateRequest } from "../../generated/validators/fish.ts";
import { synthesize, FishError, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import { decodeMessagePack, encodeMessagePack } from "../../runtime/msgpack.ts";
import type { WebSocketLike } from "../../websocket.ts";

const common = { model: "s2-pro", voice: "custom-voice", output: { format: "mp3" } } as const;
const auth = { fish: { apiKey: "test-key" } };

function validationError(request: unknown): TypeError {
  try { validateRequest(request); } catch (error) {
    assert(error instanceof TypeError);
    return error;
  }
  assert.fail("Expected the generated validator to reject this request");
}
const defaults = {
  text: "hello", reference_id: "custom-voice", references: null, format: "mp3", sample_rate: 44100,
  mp3_bitrate: 128, opus_bitrate: -1000, prosody: { speed: 1, volume: 0, normalize_loudness: true },
  temperature: 0.7, top_p: 0.7, chunk_length: 300, min_chunk_length: 50, max_new_tokens: 1024,
  repetition_penalty: 1.2, condition_on_previous_chunks: true, early_stop_threshold: 1, normalize: true, latency: "normal", features: [],
};

test("shared cross-language HTTP and timeline fixtures", async () => {
  const fixture = JSON.parse(readFileSync(new URL("../../../sdks/fixtures/fish.json", import.meta.url), "utf8"), (_, value) => value && typeof value === "object" && "$bytes" in value ? Uint8Array.from(value.$bytes) : value);
  for (const item of fixture.http) {
    expect(await Array.fromAsync(synthesize(item.request, { auth, fetch: async (_url, init) => {
      expect(decodeMessagePack(init?.body as Uint8Array)).toEqual({ ...fixture.defaults, ...item.wire });
      return new Response(Uint8Array.of(0, 255));
    } }))).toEqual([Uint8Array.of(0, 255)]);
  }
  expect(await Array.fromAsync(synthesize({ ...common, text: "hello", timestampGranularity: "segment" }, { auth, fetch: async () => new Response(fixture.timeline.map((entry: any) => `data: ${JSON.stringify(entry.packet)}\n\n`).join("")) }))).toEqual(fixture.timeline.map((entry: any) => entry.item));
});

test("future event names are ignored without suppressing audio or completion", async () => {
  const socket = new Socket();
  socket.onSend = value => {
    if (value.event === "text") { socket.receive({ event: "future-event", detail: 1 }); socket.receive({ event: "audio", audio: Uint8Array.of(1) }); }
    if (value.event === "stop") socket.receive({ event: "finish", reason: "stop" });
  };
  expect(await Array.fromAsync(synthesize({ ...common, text: input("hi") }, { webSocket: socket }))).toEqual([Uint8Array.of(1)]);
  expect(socket.closed).toBe(true);
});

test.each([
  { changes: { chunk_audio_offset_sec: 1e308 }, message: "Fish returned an invalid timestamp event" },
  { changes: { alignment: { audio_duration: 1e308, segments: [] } }, message: "Fish returned an invalid alignment snapshot" },
  { changes: { alignment: { audio_duration: 1, segments: [{ text: "a", start: 1e308, end: 1e308 }] } }, message: "Fish returned an invalid timing segment" },
])("timestamp millisecond conversion rejects overflow: $message", async ({ changes, message }) => {
  const packet = { audio_base64: "AQ==", content: "a", chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: null, ...changes };
  await expect(Array.fromAsync(synthesize({ ...common, text: "a", timestampGranularity: "segment" }, { auth, fetch: async () => new Response(`data: ${JSON.stringify(packet)}\n\n`) }))).rejects.toEqual(new TypeError(message));
});
async function* input(...values: Array<string | { readonly command: "flush" }>) { yield* values; }
class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = false;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  onSend: (value: Record<string, any>) => void = () => {};
  send(data: unknown) {
    expect(ArrayBuffer.isView(data)).toBe(true);
    const value = decodeMessagePack(data as ArrayBufferView) as Record<string, any>;
    this.sent.push(value); this.onSend(value);
  }
  close() { this.closed = true; this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: any) => void) { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(value: unknown) { this.emit("message", { data: encodeMessagePack(value) }); }
}

test("HTTP streams native bytes immediately with explicit defaults, custom voice and proxy path/query", async () => {
  let finish!: () => void;
  const stream = synthesize({ ...common, text: "hello" }, { auth, baseUrl: "https://proxy.invalid/fish/?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://proxy.invalid/fish/v1/tts?tenant=one");
    expect(init?.headers).toEqual({ authorization: "Bearer test-key", model: "s2-pro", "content-type": "application/msgpack" });
    expect(decodeMessagePack(init?.body as Uint8Array)).toEqual(defaults);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); finish = () => { controller.enqueue(Uint8Array.of(2)); controller.close(); }; } }));
  } });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  finish(); expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(2) });
  expect(await stream.next()).toEqual({ done: true, value: undefined });
});

test.each([{ model: "s1" }, { model: "s2-pro" }, { model: "s2.1-pro" }, { model: "s2.1-pro-free" }] as const)("sends the explicit $model model header", async model => {
  await Array.fromAsync(synthesize({ ...common, ...model, text: "hello" }, { auth, fetch: async (_url, init) => {
    expect(new Headers(init?.headers).get("model")).toBe(model.model); return new Response(Uint8Array.of(1));
  } }));
});

test("maps every generation control and preserves zero and false", async () => {
  await Array.fromAsync(synthesize({ ...common, text: "hello", speed: 0.5, volumeDb: -6, loudnessNormalization: false,
    temperature: 0, topP: 0, textChunkLength: 100, minTextChunkLength: 0, maxAudioTokens: 2048,
    repetitionPenalty: 1.5, conditionOnPreviousChunks: false, earlyStopThreshold: 0, textNormalization: false,
    latencyOptimization: "aggressive", features: ["quality-guard"], output: { format: "ogg_opus", bitRateBps: 32000 },
  }, { auth, fetch: async (_url, init) => {
    expect(decodeMessagePack(init?.body as Uint8Array)).toEqual({ ...defaults, format: "opus", sample_rate: 48000,
      opus_bitrate: 32000, prosody: { speed: 0.5, volume: -6, normalize_loudness: false },
      temperature: 0, top_p: 0, chunk_length: 100, min_chunk_length: 0, max_new_tokens: 2048,
      repetition_penalty: 1.5, condition_on_previous_chunks: false, early_stop_threshold: 0, normalize: false,
      latency: "low", features: ["quality-guard"],
    }); return new Response(Uint8Array.of(1));
  } }));
});

test.each([
  { output: { format: "wav", sampleRateHz: 24000 }, wire: { format: "wav", sample_rate: 24000 } },
  { output: { format: "pcm" }, wire: { format: "pcm", sample_rate: 44100 } },
  { output: { format: "mp3", bitRateBps: 192000 }, wire: { format: "mp3", sample_rate: 44100, mp3_bitrate: 192 } },
  { output: { format: "ogg_opus" }, wire: { format: "opus", sample_rate: 48000 } },
] as const)("maps audio options %j", async ({ output, wire }) => {
  await Array.fromAsync(synthesize({ ...common, text: "hello", output, latencyOptimization: "moderate" }, { auth, fetch: async (_url, init) => {
    expect(decodeMessagePack(init?.body as Uint8Array)).toEqual({ ...defaults, ...wire, latency: "balanced" });
    return new Response(Uint8Array.of(1));
  } }));
});

test("inline recordings retain raw bytes and work independently of voice selection", async () => {
  const referenceSamples = [{ audio: Uint8Array.of(0, 255, 1), text: "my voice" }];
  for (const voice of [undefined, "custom-voice"]) {
    await Array.fromAsync(synthesize({ ...common, voice, text: "hello", referenceSamples }, { auth, fetch: async (_url, init) => {
      expect(decodeMessagePack(init?.body as Uint8Array)).toEqual({ ...defaults, reference_id: voice ?? null, references: referenceSamples });
      return new Response(Uint8Array.of(1));
    } }));
  }
});

test("multi-speaker existing voices and zero-shot reference groups preserve native indexes", async () => {
  const samples = [{ audio: Uint8Array.of(1), text: "sample" }];
  const cases = [
    { speakers: [{ voice: "custom-a" }, { voice: "custom-b" }], reference_id: ["custom-a", "custom-b"], references: null },
    { speakers: [{ referenceSamples: samples }, { referenceSamples: [...samples, ...samples] }], reference_id: ["0", "1"], references: [samples, [...samples, ...samples]] },
  ] as const;
  for (const item of cases) {
    await Array.fromAsync(synthesize({ model: "s2.1-pro", text: "<|speaker:0|>Hello<|speaker:1|>Hi", output: common.output, speakers: item.speakers }, { auth, fetch: async (_url, init) => {
      expect(decodeMessagePack(init?.body as Uint8Array)).toEqual({ ...defaults, text: "<|speaker:0|>Hello<|speaker:1|>Hi", reference_id: item.reference_id, references: item.references });
      return new Response(Uint8Array.of(1));
    } }));
  }
});

test("timestamp audio is immediate; cumulative snapshots replace per native group without duplication", async () => {
  const packet = { audio_base64: "AQ==", content: "hello world", alignment: null, chunk_seq: 0, chunk_audio_offset_sec: 0 };
  let finish!: () => void;
  const stream = synthesize({ ...common, text: "hello", timestampGranularity: "segment" }, { auth, fetch: async url => {
    expect(String(url)).toBe("https://api.fish.audio/v1/tts/stream/with-timestamp");
    return new Response(new ReadableStream({ start(controller) {
      const send = (value: unknown) => { for (const byte of new TextEncoder().encode(`data: ${JSON.stringify(value)}\r\n\r\n`)) controller.enqueue(Uint8Array.of(byte)); };
      send(packet);
      finish = () => {
        send({ ...packet, audio_base64: "Ag==", alignment: { audio_duration: 1, segments: [{ text: "hello world", start: 0, end: 1 }] } });
        send({ ...packet, audio_base64: "Aw==", alignment: { audio_duration: 1.2, segments: [{ text: "hello world", start: 0.1, end: 1.2 }] } });
        send({ ...packet, audio_base64: "BA==", chunk_seq: 1, chunk_audio_offset_sec: 1.2, alignment: { audio_duration: 0.5, segments: [] } });
        send({ ...packet, audio_base64: "", alignment: null });
        controller.close();
      };
    } }));
  } });
  expect(await stream.next()).toEqual({ done: false, value: { correlation: "timeline", correlationId: "0", timelineOffsetMs: 0, audio: Uint8Array.of(1), timestamps: [] } });
  finish();
  expect(await Array.fromAsync(stream)).toEqual([
    { correlation: "timeline", correlationId: "0", timelineOffsetMs: 0, audio: Uint8Array.of(2), timestampUpdate: "replace", durationMs: 1000, timestamps: [{ kind: "segment", value: "hello world", startTimeMs: 0, endTimeMs: 1000 }] },
    { correlation: "timeline", correlationId: "0", timelineOffsetMs: 0, audio: Uint8Array.of(3), timestampUpdate: "replace", durationMs: 1200, timestamps: [{ kind: "segment", value: "hello world", startTimeMs: 100, endTimeMs: 1200 }] },
    { correlation: "timeline", correlationId: "1", timelineOffsetMs: 1200, audio: Uint8Array.of(4), timestampUpdate: "replace", durationMs: 500, timestamps: [] },
    { correlation: "timeline", correlationId: "0", timelineOffsetMs: 0, audio: new Uint8Array(), timestamps: [] },
  ]);
});

test("WebSocket sends start, incremental text, flush, stop and yields byte-native audio", async () => {
  const socket = new Socket();
  socket.onSend = value => {
    if (value.event === "text") socket.receive({ event: "audio", audio: Uint8Array.of(1, 2) });
    if (value.event === "stop") socket.receive({ event: "finish", reason: "stop" });
  };
  expect(await Array.fromAsync(synthesize({ ...common, text: input("hello", { command: "flush" }, "world") }, { webSocket: socket }))).toEqual([Uint8Array.of(1, 2), Uint8Array.of(1, 2)]);
  expect(socket.sent).toEqual([{ event: "start", request: { ...defaults, text: "" } }, { event: "text", text: "hello" }, { event: "flush" }, { event: "text", text: "world" }, { event: "stop" }]);
  expect(socket.closed).toBe(true); expect(socket.binaryType).toBe("arraybuffer");
});

test("abort does not wait for stalled input or its return promise", async () => {
  const socket = new Socket(); const controller = new AbortController();
  let reading!: () => void; const started = new Promise<void>(resolve => { reading = resolve; }); let returned = false;
  const text: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({ next: () => { reading(); return new Promise(() => {}); }, return: () => { returned = true; return new Promise(() => {}); } }) };
  const result = Array.fromAsync(synthesize({ ...common, text }, { webSocket: socket, signal: controller.signal }));
  await started; const reason = new Error("cancelled"); controller.abort(reason);
  await expect(result).rejects.toBe(reason);
  expect(returned).toBe(true); expect(socket.closed).toBe(true);
});

test("output errors are not starved by immediately-ready input", async () => {
  const socket = new Socket(); let consumed = 0; let returned = false;
  socket.onSend = value => { if (value.event === "text") socket.receive({ event: "finish", reason: "error" }); };
  const text: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({ next: async () => { consumed++; if (consumed > 4) throw new Error("output starved"); return { done: false, value: "hello" }; }, return: async () => { returned = true; return { done: true, value: undefined }; } }) };
  await expect(Array.fromAsync(synthesize({ ...common, text }, { webSocket: socket }))).rejects.toEqual(new FishError(0, "Streaming synthesis failed", "error"));
  expect(returned).toBe(true); expect(socket.closed).toBe(true);
});

test("consumer exit closes input and socket", async () => {
  const socket = new Socket(); let returned = false;
  socket.onSend = value => { if (value.event === "text") socket.receive({ event: "audio", audio: Uint8Array.of(1) }); };
  const stream = synthesize({ ...common, text: (async function* () { try { for (;;) yield "hello"; } finally { returned = true; } })() }, { webSocket: socket });
  await stream.next(); await stream.return?.();
  expect(socket.closed).toBe(true); expect(returned).toBe(true);
});

test("normal close without finish is a protocol failure", async () => {
  const socket = new Socket(); socket.onSend = value => { if (value.event === "stop") socket.close(); };
  await expect(Array.fromAsync(synthesize({ ...common, text: input("hello") }, { webSocket: socket }))).rejects.toEqual(new TypeError("Fish WebSocket closed before session completion"));
});

test("server finish does not silently truncate pending input", async () => {
  const socket = new Socket(); socket.onSend = value => { if (value.event === "start") socket.receive({ event: "finish", reason: "stop" }); };
  await expect(Array.fromAsync(synthesize({ ...common, text: input("hello", "world") }, { webSocket: socket }))).rejects.toEqual(new TypeError("Fish finished before the input stream ended"));
});

test("generated item validation rejects unsupported clear without transmitting it", async () => {
  const socket = new Socket();
  const text = (async function* () { yield { command: "clear" }; })();
  // @ts-expect-error Fish has flush but no native clear command.
  const stream = synthesize({ ...common, text }, { webSocket: socket });
  await expect(Array.fromAsync(stream)).rejects.toEqual(new TypeError('Invalid fish TTS input item:\ntext item: expected string\ntext item["command"]: expected "flush"'));
  expect(socket.sent).toEqual([{ event: "start", request: { ...defaults, text: "" } }]); expect(socket.closed).toBe(true);
});

test.each([
  { name: "unknown model", changes: { model: "future" } },
  { name: "S1 loudness", changes: { model: "s1", loudnessNormalization: false } },
  { name: "S1 speakers", changes: { model: "s1", voice: undefined, speakers: [{ voice: "a" }] } },
  { name: "voice and speakers", changes: { speakers: [{ voice: "a" }] } },
  { name: "mixed conditioning groups", changes: { voice: undefined, speakers: [{ voice: "a" }, { referenceSamples: [{ audio: Uint8Array.of(1), text: "a" }] }] } },
  { name: "empty voice", changes: { voice: "" } },
  { name: "no conditioning", changes: { voice: undefined } },
  { name: "speed out of range", changes: { speed: 2.1 } },
  { name: "temperature out of range", changes: { temperature: -0.1 } },
  { name: "topP out of range", changes: { topP: 1.1 } },
  { name: "chunk length out of range", changes: { textChunkLength: 99 } },
  { name: "fractional chunk length", changes: { textChunkLength: 100.5 } },
  { name: "fractional minimum chunk length", changes: { minTextChunkLength: 50.5 } },
  { name: "fractional token limit", changes: { maxAudioTokens: 1024.5 } },
  { name: "fractional sample rate", changes: { output: { format: "pcm", sampleRateHz: 24000.5 } } },
  { name: "minimum chunk length out of range", changes: { minTextChunkLength: 101 } },
  { name: "early stop out of range", changes: { earlyStopThreshold: -1 } },
  { name: "invalid bitrate", changes: { output: { format: "mp3", bitRateBps: 24000 } } },
  { name: "PCM bitrate", changes: { output: { format: "pcm", bitRateBps: 128000 } } },
  { name: "unsupported encoding", changes: { output: { format: "mp3", sampleEncoding: "float_32" } } },
  { name: "zero sample rate", changes: { output: { format: "pcm", sampleRateHz: 0 } } },
  { name: "streaming timestamps", changes: { text: input("hello"), timestampGranularity: "segment" } },
  { name: "missing reference transcript", changes: { referenceSamples: [{ audio: Uint8Array.of(1) }] } },
  { name: "fractional text chunk", changes: { textChunkLength: 100.5 } },
  { name: "fractional sample rate", changes: { output: { format: "pcm", sampleRateHz: 24000.5 } } },
  { name: "empty references", changes: { referenceSamples: [] } },
  { name: "empty speakers", changes: { voice: undefined, speakers: [] } },
  { name: "empty speaker references", changes: { voice: undefined, speakers: [{ referenceSamples: [] }] } },
] as const)("generated request validation rejects $name before network I/O", async ({ changes }) => {
  const request = { ...common, text: "hello", ...changes } as unknown as TtsRequest;
  await expect(synthesize(request, { auth, fetch: async () => { throw new Error("must not fetch"); } }).next()).rejects.toEqual(validationError(request));
});

test("rejects empty reference audio bytes", async () => {
  const request = { ...common, text: "hello", referenceSamples: [{ audio: new Uint8Array(), text: "sample" }] };
  await expect(synthesize(request, { auth }).next()).rejects.toEqual(new TypeError("Fish reference audio must not be empty"));
});

test("HTTP errors preserve status and reason without retry", async () => {
  let calls = 0;
  await expect(synthesize({ ...common, text: "hello" }, { auth, fetch: async () => { calls++; return new Response(JSON.stringify({ status: 402, message: "Insufficient balance", reason: "balance" }), { status: 402 }); } }).next()).rejects.toEqual(new FishError(402, "Insufficient balance", "balance"));
  expect(calls).toBe(1);
});

test("cancels HTTP response on consumer exit and avoids fetch when pre-aborted", async () => {
  let cancelled = false;
  const stream = synthesize({ ...common, text: "hello" }, { auth, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; } })) });
  await stream.next(); await stream.return?.(); expect(cancelled).toBe(true);
  const reason = new Error("cancelled");
  await expect(synthesize({ ...common, text: "hello" }, { auth, signal: AbortSignal.abort(reason), fetch: async () => { throw new Error("must not fetch"); } }).next()).rejects.toBe(reason);
});

test("dispatch inference keeps model subsets and excludes unsupported timestamp and clear modes", () => {
  const valid: TtsRequest = { ...common, text: input("hello") };
  expectTypeOf(dispatch("fish", valid)).toEqualTypeOf<ReturnType<typeof synthesize>>();
  // @ts-expect-error S1 cannot select multiple speakers.
  const speakers: TtsRequest = { model: "s1", text: "hello", output: common.output, speakers: [{ voice: "a" }] };
  // @ts-expect-error S1 ignores loudness normalization, so it is not exposed.
  const loudness: TtsRequest = { ...common, model: "s1", text: "hello", loudnessNormalization: false };
  // @ts-expect-error Streaming input does not support timestamps.
  const timed: TtsRequest = { ...common, text: input("hello"), timestampGranularity: "segment" };
  void speakers; void loudness; void timed;
});

test("resolves shared auth before Speechswitch and provider environment keys", async () => {
  const saved = [process.env.SPEECHSWITCH_FISH_API_KEY, process.env.FISH_API_KEY];
  try {
    process.env.SPEECHSWITCH_FISH_API_KEY = "speechswitch-key"; process.env.FISH_API_KEY = "provider-key";
    for (const key of ["test-key", "speechswitch-key", "provider-key"]) {
      if (key === "provider-key") delete process.env.SPEECHSWITCH_FISH_API_KEY;
      await Array.fromAsync(synthesize({ ...common, text: "hello" }, { auth: key === "test-key" ? auth : undefined, fetch: async (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`); return new Response(Uint8Array.of(1));
      } }));
    }
    delete process.env.FISH_API_KEY;
    await expect(synthesize({ ...common, text: "hello" }).next()).rejects.toEqual(new TypeError("Missing auth.fish.apiKey configuration"));
  } finally {
    if (saved[0] === undefined) delete process.env.SPEECHSWITCH_FISH_API_KEY; else process.env.SPEECHSWITCH_FISH_API_KEY = saved[0];
    if (saved[1] === undefined) delete process.env.FISH_API_KEY; else process.env.FISH_API_KEY = saved[1];
  }
});

test("deadline closes a socket waiting for stalled input", async () => {
  const socket = new Socket();
  const text: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
  await expect(Array.fromAsync(synthesize({ ...common, text }, { webSocket: socket, timeoutMs: 10 }))).rejects.toEqual(new DOMException("Fish synthesis deadline expired", "TimeoutError"));
  expect(socket.closed).toBe(true);
});

test.each([-1, 1.5, 2147483648, Infinity])("rejects invalid deadline %s before network I/O", async timeoutMs => {
  await expect(synthesize({ ...common, text: "hello" }, { auth, timeoutMs }).next()).rejects.toEqual(new TypeError("Fish timeoutMs must be an integer between 0 and 2147483647"));
});

test("an already expired deadline does not fetch", async () => {
  await expect(synthesize({ ...common, text: "hello" }, { auth, timeoutMs: 0, fetch: async () => { throw new Error("must not fetch"); } }).next()).rejects.toEqual(new DOMException("Fish synthesis deadline expired", "TimeoutError"));
});

test("invalid binary server event fails and closes the socket", async () => {
  const socket = new Socket(); socket.onSend = value => { if (value.event === "start") socket.receive({ event: "audio", audio: "not bytes" }); };
  await expect(Array.fromAsync(synthesize({ ...common, text: input("hello") }, { webSocket: socket }))).rejects.toEqual(new TypeError("Fish returned an invalid WebSocket event"));
  expect(socket.closed).toBe(true);
});

test("input failure propagates without waiting for server completion", async () => {
  const socket = new Socket(); const reason = new Error("input failed");
  await expect(Array.fromAsync(synthesize({ ...common, text: (async function* () { throw reason; yield "unreachable"; })() }, { webSocket: socket }))).rejects.toBe(reason);
  expect(socket.closed).toBe(true);
});

test("invalid timestamp ordering rejects and cancels the HTTP response", async () => {
  let cancelled = false;
  const packet = { audio_base64: "AQ==", content: "hello", chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: { audio_duration: 1, segments: [{ text: "hello", start: 1, end: 0 }] } };
  await expect(Array.fromAsync(synthesize({ ...common, text: "hello", timestampGranularity: "segment" }, { auth, fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(packet)}\n\n`)); }, cancel() { cancelled = true; },
  })) }))).rejects.toEqual(new TypeError("Fish returned an invalid timing segment"));
  expect(cancelled).toBe(true);
});

test("Fish and MessagePack bundle for browsers without external runtime imports", async () => {
  const bundle = await Bun.build({ entrypoints: [new URL("./index.ts", import.meta.url).pathname], target: "browser" });
  expect(bundle.success).toBe(true);
  const transpiler = new Bun.Transpiler({ loader: "js" });
  expect(transpiler.scanImports(await bundle.outputs[0]!.text())).toEqual([]);
});
