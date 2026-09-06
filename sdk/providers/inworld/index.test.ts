import { expect, test } from "bun:test";
import { synthesize, InworldError } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import { encodeBase64 } from "../../base64.ts";
import type { WebSocketLike } from "../../websocket.ts";

const common = { model: "inworld-tts-2", voice: "custom-voice", output: { format: "pcm" } } as const;
const auth = { inworld: { apiKey: "test-key" } };
const settings = { voiceId: "custom-voice", modelId: "inworld-tts-2", audioConfig: { audioEncoding: "PCM", sampleRateHertz: 48000, speakingRate: 1 },
  deliveryMode: "BALANCED", applyTextNormalization: "APPLY_TEXT_NORMALIZATION_UNSPECIFIED", timestampType: "TIMESTAMP_TYPE_UNSPECIFIED" };
const alignment = { wordAlignment: { words: ["Hi", " "], wordStartTimeSeconds: [0, 0.25], wordEndTimeSeconds: [0.25, 0.25],
  phoneticDetails: [{ wordIndex: 0, phones: [{ phoneSymbol: "h", startTimeSeconds: 0, durationSeconds: 0.125, visemeSymbol: "aei" }] }] } };
const marks = [
  { kind: "word", value: "Hi", startTimeMs: 0, endTimeMs: 250, wordIndex: 0 },
  { kind: "word", value: " ", startTimeMs: 250, endTimeMs: 250, wordIndex: 1 },
  { kind: "phoneme", value: "h", startTimeMs: 0, endTimeMs: 125, wordIndex: 0 },
  { kind: "viseme", value: "aei", startTimeMs: 0, endTimeMs: 125, wordIndex: 0 },
] as const;
async function* input(...values: (string | { readonly command: "flush" })[]) { yield* values; }
class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = false;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  onSend: (message: Record<string, any>) => void = message => {
    if (message.create) this.receive({ contextCreated: message.create });
    if (message.send_text) this.receive({ audioChunk: { audioContent: "AQI=" } });
    if (message.flush_context) this.receive({ flushCompleted: {} });
    if (message.close_context) this.receive({ contextClosed: {} });
  };
  send(data: unknown) { const message = JSON.parse(data as string); this.sent.push(message); this.onSend(message); }
  close() { this.closed = true; this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: any) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(result: object) { this.emit("message", { data: JSON.stringify({ result: { contextId: "ctx", ...result } }) }); }
}

test("Inworld HTTP streaming sends resolved settings, existing voice and ordered context; audio is incremental", async () => {
  let finish!: () => void;
  const stream = dispatch("inworld", { ...common, text: "Hello", instructions: "whisper", deliveryMode: "creative", language: "fr-FR", speed: 0.5,
    textNormalization: false, audioEnhancement: true, contextBefore: { texts: ["Earlier", "Then"] } }, {
    auth, baseUrl: "https://proxy.invalid/root/?tenant=one", fetch: async (url, init) => {
      expect(String(url)).toBe("https://proxy.invalid/root/tts/v1/voice:stream?tenant=one");
      expect(init?.headers).toEqual({ Authorization: "Basic test-key", "content-type": "application/json" });
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({ ...settings, text: "Hello", audioConfig: { ...settings.audioConfig, speakingRate: 0.5 }, instruction: "whisper",
        deliveryMode: "CREATIVE", language: "fr-FR", applyTextNormalization: "OFF", enhanceGeneration: true, synthesisContext: { previousRequests: [{ text: "Earlier" }, { text: "Then" }] }, timestampTransportStrategy: "ASYNC" });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"result":{"audioContent":"AQI="}}\n')); finish = () => controller.close(); } }));
    },
  });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) }); finish();
  expect(await stream.next()).toEqual({ done: true, value: undefined });
});

test.each(["stream", "single"] as const)("Inworld %s HTTP preserves alignment and distinguishes bearer auth", async httpMode => {
  const result = await Array.fromAsync(synthesize({ ...common, text: "Hi", timestampGranularity: "word", timestampDelivery: "chunk" }, {
    httpMode, auth: { inworld: { apiKey: "unused", accessToken: "once" } }, fetch: async (url, init) => {
      expect(String(url)).toBe(`https://api.inworld.ai/tts/v1/voice${httpMode === "stream" ? ":stream" : ""}`);
      expect(init?.headers).toEqual({ Authorization: "Bearer once", "content-type": "application/json" });
      expect(JSON.parse(init?.body as string)).toEqual({ ...settings, text: "Hi", timestampType: "WORD", enhanceGeneration: false, ...(httpMode === "stream" ? { timestampTransportStrategy: "SYNC" } : {}) });
      const packet = { audioContent: "AQI=", timestampInfo: alignment };
      return Response.json(httpMode === "stream" ? { result: packet } : packet);
    },
  }));
  expect(result).toEqual([{ correlation: "chunk", audio: Uint8Array.of(1, 2), timestamps: marks }]);
});

test("trailing alignment does not acquire an inferred audio-chunk association", async () => {
  const body = [{ result: { audioContent: "AQI=" } }, { result: { audioContent: "AwQ=" } }, { result: { timestampInfo: alignment } }].map(value => JSON.stringify(value)).join("\n");
  expect(await Array.fromAsync(synthesize({ ...common, text: "Hi", timestampGranularity: "word" }, { auth, fetch: async () => new Response(body) }))).toEqual([
    { correlation: "timeline", audio: Uint8Array.of(1, 2), timestamps: [] }, { correlation: "timeline", audio: Uint8Array.of(3, 4), timestamps: [] }, { correlation: "timeline", timestamps: marks },
  ]);
});

test("WebSocket preserves text fragments and acknowledges native flushes without clear emulation", async () => {
  const socket = new Socket();
  expect(await Array.fromAsync(synthesize({ ...common, text: input("Hel", "lo", { command: "flush" }, "!"), textFlushDelayMs: 50, textBufferThreshold: 200, automaticTextFlushing: true }, { webSocket: socket, contextId: "ctx" }))).toEqual([
    Uint8Array.of(1, 2), Uint8Array.of(1, 2), { event: "flush", correlationId: "ctx:0", inputGroupId: "0" }, Uint8Array.of(1, 2),
  ]);
  expect(socket.sent).toEqual([
    { contextId: "ctx", create: { ...settings, timestampTransportStrategy: "ASYNC", maxBufferDelayMs: 50, bufferCharThreshold: 200, autoMode: true } },
    { contextId: "ctx", send_text: { text: "Hel" } }, { contextId: "ctx", send_text: { text: "lo" } },
    { contextId: "ctx", flush_context: {} }, { contextId: "ctx", send_text: { text: "!" } }, { contextId: "ctx", close_context: {} },
  ]); expect(socket.closed).toBe(true);
});

test.each(["chunk", "trailing"] as const)("native flush boundaries reset %s timestamp groups, including automatic flushes", async delivery => {
  const socket = new Socket(); socket.onSend = message => {
    if (message.create) socket.receive({ contextCreated: {} });
    if (message.send_text) {
      if (delivery === "chunk") socket.receive({ audioChunk: { audioContent: "AQI=", timestampInfo: alignment } });
      else { socket.receive({ audioChunk: { audioContent: "AQI=" } }); socket.receive({ audioChunk: { timestampInfo: alignment } }); }
      socket.receive({ flushCompleted: {} });
    }
    if (message.close_context) socket.receive({ contextClosed: {} });
  };
  const values = await Array.fromAsync(synthesize({ ...common, text: input("Hi", "Hi"), timestampGranularity: "word", timestampDelivery: delivery }, { webSocket: socket, contextId: "ctx" }));
  expect(values).toEqual([0, 1].flatMap(index => [
    ...(delivery === "chunk" ? [{ correlation: "chunk" as const, correlationId: `ctx:${index}`, audio: Uint8Array.of(1, 2), timestamps: marks }]
      : [{ correlation: "timeline" as const, correlationId: `ctx:${index}`, audio: Uint8Array.of(1, 2), timestamps: [] }, { correlation: "timeline" as const, correlationId: `ctx:${index}`, timestamps: marks }]),
    { event: "flush" as const, correlationId: `ctx:${index}`, inputGroupId: String(index) },
  ]));
});

test.each([
  [{ format: "mp3", sampleRateHz: 24000, bitRateBps: 64000 }, { audioEncoding: "MP3", sampleRateHertz: 24000, bitRate: 64000 }],
  [{ format: "ogg_opus" }, { audioEncoding: "OGG_OPUS", sampleRateHertz: 48000, bitRate: 128000 }],
  [{ format: "mulaw" }, { audioEncoding: "MULAW", sampleRateHertz: 8000 }],
  [{ format: "alaw" }, { audioEncoding: "ALAW", sampleRateHertz: 8000 }],
  [{ format: "wav" }, { audioEncoding: "WAV", sampleRateHertz: 48000 }],
  [{ format: "flac" }, { audioEncoding: "FLAC", sampleRateHertz: 48000 }],
] as const)("output settings %j have explicit wire conversions", async (output, expected) => {
  await Array.fromAsync(synthesize({ ...common, text: "Hi", output }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(init?.body as string).audioConfig).toEqual({ ...expected, speakingRate: 1 }); return new Response('{"result":{"audioContent":"AQI="}}');
  } }));
});

function wave(sampleRate = 48000): Uint8Array {
  const data = new Uint8Array(46); const view = new DataView(data.buffer);
  data.set(new TextEncoder().encode("RIFF"), 0); view.setUint32(4, 38, true); data.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  data.set(new TextEncoder().encode("data"), 36); view.setUint32(40, 2, true); data.set([1, 2], 44); return data;
}
test("WAV headers split across frames and repeated per flush become one incremental WAV", async () => {
  const socket = new Socket(); socket.onSend = message => {
    if (message.create) socket.receive({ contextCreated: {} });
    if (message.send_text) {
      const data = wave(); socket.receive({ audioChunk: { audioContent: encodeBase64(data.subarray(0, 20)) } });
      socket.receive({ audioChunk: { audioContent: encodeBase64(data.subarray(20)) } }); socket.receive({ flushCompleted: {} });
    }
    if (message.close_context) socket.receive({ contextClosed: {} });
  };
  const expected = wave(); const view = new DataView(expected.buffer); view.setUint32(4, 0xffffffff, true); view.setUint32(40, 0xffffffff, true);
  expect(await Array.fromAsync(synthesize({ ...common, text: input("A", "B"), output: { format: "wav" } }, { webSocket: socket, contextId: "ctx" }))).toEqual([
    expected, { event: "flush", correlationId: "ctx:0", inputGroupId: "0" }, Uint8Array.of(1, 2), { event: "flush", correlationId: "ctx:1", inputGroupId: "1" },
  ]);
});

test("abort releases a stalled input without waiting for next or return", async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next() { started(); return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const socket = new Socket(); const controller = new AbortController();
  const pending = synthesize({ ...common, text }, { webSocket: socket, contextId: "ctx", signal: controller.signal }).next();
  await ready; controller.abort(new Error("barge in"));
  await expect(pending).rejects.toEqual(new Error("barge in")); expect(returned).toBe(1); expect(socket.closed).toBe(true);
  expect(socket.sent.map(message => Object.keys(message).sort())).toEqual([["contextId", "create"]]);
});

test("early consumer exit closes the socket and returns unfinished input", async () => {
  let returned = 0; let first = true;
  const text = { [Symbol.asyncIterator]() { return { next() { if (first) { first = false; return Promise.resolve({ done: false as const, value: "Hi" }); } return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const socket = new Socket(); const result = synthesize({ ...common, text }, { webSocket: socket, contextId: "ctx" });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) }); await result.return!();
  expect(socket.closed).toBe(true); expect(returned).toBe(1);
});

test.each([
  [{ contextId: "other", contextCreated: {} }, "Inworld returned an unexpected context ID"],
  [{ audioChunk: { audioContent: "AQI=" } }, "Inworld returned output before contextCreated"],
  [{ contextCreated: {}, contextClosed: {} }, "Inworld returned an invalid context event"],
  [{ contextClosed: {} }, "Inworld returned output before contextCreated"],
] as const)("rejects invalid socket protocol state %j", async (packet, message) => {
  const socket = new Socket(); socket.onSend = () => socket.receive(packet);
  await expect(Array.fromAsync(synthesize({ ...common, text: input("Hi") }, { webSocket: socket, contextId: "ctx" }))).rejects.toEqual(new TypeError(message));
  expect(socket.closed).toBe(true);
});

test.each([
  [{ wordAlignment: { words: ["Hi"], wordStartTimeSeconds: [], wordEndTimeSeconds: [1] } }, "Inworld returned mismatched timestamp arrays"],
  [{ characterAlignment: { characters: ["H"], characterStartTimeSeconds: [1], characterEndTimeSeconds: [0] } }, "Inworld returned a reversed timestamp range"],
  [{ wordAlignment: { ...alignment.wordAlignment, phoneticDetails: [{ wordIndex: 10, phones: [] }] } }, "Inworld returned an invalid phonetic word index"],
] as const)("rejects malformed alignment %j", async (timestampInfo, message) => {
  await expect(Array.fromAsync(synthesize({ ...common, text: "Hi", timestampGranularity: "word" }, { auth,
    fetch: async () => Response.json({ result: { audioContent: "AQI=", timestampInfo } }),
  }))).rejects.toEqual(new TypeError(message));
});

test("HTTP and in-stream errors retain upstream codes", async () => {
  for (const response of [Response.json({ code: 7, message: "denied" }, { status: 403 }), Response.json({ error: { code: 7, message: "denied" } })]) {
    const error = await Array.fromAsync(synthesize({ ...common, text: "Hi" }, { auth, fetch: async () => response })).catch(error => error);
    expect(error).toBeInstanceOf(InworldError); expect({ message: error.message, code: error.code, statusCode: error.statusCode }).toEqual({ message: "denied", code: 7, statusCode: response.ok ? null : 403 });
  }
});

test.each([200, 403])("Inworld %i JSON decoding preserves split Unicode and strips only the leading BOM", async status => {
  const packet = status === 200 ? { audioContent: "AQI=" } : { code: 7, message: "refusé\uFEFF" };
  const encoded = new TextEncoder().encode("\uFEFF" + JSON.stringify(packet));
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const result = await Array.fromAsync(synthesize({ ...common, text: "Hi" }, { auth, httpMode: "single",
    fetch: async () => new Response(body, { status }),
  })).catch(error => error);
  expect(result).toEqual(status === 200 ? [Uint8Array.of(1, 2)] : new InworldError("refusé\uFEFF", 403, 7));
  expect(body.locked).toBe(false);
});

test("transport-only invariants are checked before network access", async () => {
  const fetch = async () => { throw new Error("unexpected network"); };
  await expect(synthesize({ ...common, text: "x".repeat(2001) }, { auth, fetch, httpMode: "single" }).next()).rejects.toEqual(new TypeError("Inworld single-response text must not exceed 2000 characters"));
  await expect(synthesize({ ...common, text: "Hi", contextBefore: { texts: ["x".repeat(1001), "x".repeat(1000)] } }, { auth, fetch }).next()).rejects.toEqual(new TypeError("Inworld preceding context must not exceed 2000 characters"));
  await expect(synthesize({ ...common, text: input("Hi"), textBufferThreshold: 1.5 }, { auth, fetch }).next()).rejects.toEqual(new TypeError("Invalid inworld TTS request"));
  await expect(synthesize({ ...common, text: "Hi" }, { auth, fetch, timeoutMs: 0 }).next()).rejects.toEqual(new DOMException("Inworld synthesis deadline expired", "TimeoutError"));
  const socket = new Socket(); await expect(synthesize({ ...common, text: input("x".repeat(2001)) }, { webSocket: socket, contextId: "ctx" }).next()).rejects.toEqual(new TypeError("Inworld text chunks must not exceed 2000 characters"));
  expect(socket.closed).toBe(true);
});

test("deadline terminates an injected HTTP fetch that ignores abort", async () => {
  await expect(synthesize({ ...common, text: "Hi" }, { auth, timeoutMs: 5, fetch: () => new Promise<Response>(() => {}) }).next())
    .rejects.toEqual(new DOMException("Inworld synthesis deadline expired", "TimeoutError"));
});

test("HTTP cancellation releases a stalled body and late fetch responses are canceled", async () => {
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let canceled = 0; const controller = new AbortController();
  const result = synthesize({ ...common, text: "Hi" }, { auth, signal: controller.signal, fetch: async () => {
    entered(); return new Response(new ReadableStream({ cancel() { canceled++; } }));
  } });
  const pending = result.next(); await started; await Promise.resolve(); controller.abort(new Error("stop"));
  await expect(pending).rejects.toEqual(new Error("stop")); expect(canceled).toBe(1);

  const lateController = new AbortController(); let deliver!: (value: Response) => void;
  const late = synthesize({ ...common, text: "Hi" }, { auth, signal: lateController.signal, fetch: () => new Promise<Response>(resolve => { deliver = resolve; }) }).next();
  lateController.abort(new Error("late stop")); await expect(late).rejects.toEqual(new Error("late stop"));
  deliver(new Response(new ReadableStream({ cancel() { canceled++; } }))); await Promise.resolve(); expect(canceled).toBe(2);
});

test("a clean socket close is not a successful context completion", async () => {
  const socket = new Socket(); socket.onSend = message => {
    if (message.create) socket.receive({ contextCreated: {} });
    if (message.close_context) socket.close();
  };
  await expect(Array.fromAsync(synthesize({ ...common, text: input("Hi") }, { webSocket: socket, contextId: "ctx" })))
    .rejects.toEqual(new TypeError("Inworld WebSocket closed before contextClosed"));
});

test("duplicate creation, premature completion and malformed frames close the socket", async () => {
  for (const failure of ["duplicate", "premature", "malformed"] as const) {
    const socket = new Socket(); socket.onSend = message => {
      if (!message.create) return;
      socket.receive({ contextCreated: {} });
      if (failure === "duplicate") socket.receive({ contextCreated: {} });
      else if (failure === "premature") socket.receive({ contextClosed: {} });
      else socket.emit("message", { data: Uint8Array.of(1) });
    };
    const text = { [Symbol.asyncIterator]() { return { next() { return new Promise<IteratorResult<string>>(() => {}); } }; } };
    const message = failure === "duplicate" ? "Inworld returned duplicate contextCreated" : failure === "premature" ? "Inworld completed before the input stream ended" : "Inworld returned a non-text WebSocket frame";
    await expect(synthesize({ ...common, text }, { webSocket: socket, contextId: "ctx" }).next()).rejects.toEqual(new TypeError(message)); expect(socket.closed).toBe(true);
  }
});

test.each(["truncated", "changed", "invalid-format"] as const)("WAV rejects %s headers", async failure => {
  const socket = new Socket(); let count = 0;
  socket.onSend = message => {
    if (message.create) socket.receive({ contextCreated: {} });
    if (message.send_text) {
      const data = wave(++count === 1 ? 48000 : 24000);
      if (failure === "invalid-format") new DataView(data.buffer).setUint16(20, 3, true);
      socket.receive({ audioChunk: { audioContent: encodeBase64(failure === "truncated" ? data.subarray(0, 30) : data) } }); socket.receive({ flushCompleted: {} });
    }
    if (message.close_context) socket.receive({ contextClosed: {} });
  };
  const message = failure === "truncated" ? "Inworld returned an incomplete WAV header" : failure === "changed" ? "Inworld changed WAV format between flushes" : "Inworld returned an invalid PCM WAV format";
  await expect(Array.fromAsync(synthesize({ ...common, text: input("A", "B"), output: { format: "wav" } }, { webSocket: socket, contextId: "ctx" }))).rejects.toEqual(new TypeError(message));
});

test.each(["inworld-tts-1.5-max", "inworld-tts-1.5-mini", "inworld-tts-2-flash"] as const)("%s sends temperature rather than TTS-2 delivery controls", async model => {
  await Array.fromAsync(synthesize({ ...common, model, text: "Hi", temperature: 0 }, { auth, fetch: async (_url, init) => {
    const { deliveryMode: _unused, ...rest } = settings;
    expect(JSON.parse(init?.body as string)).toEqual({ ...rest, modelId: model, temperature: 1, text: "Hi", enhanceGeneration: false, timestampTransportStrategy: "ASYNC" });
    return new Response('{"result":{"audioContent":"AQI="}}');
  } }));
});
