import { expect, test } from "bun:test";
import { synthesize, VoiceAiError, type TtsInput, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import { validateRequest } from "../../generated/validators/voice.ai.ts";
import type { WebSocketLike } from "../../websocket.ts";

class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = 0;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  constructor(readonly receive: (message: Record<string, any>, socket: Socket) => void = () => {}) {}
  addEventListener(type: string, listener: (event: any) => void) { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown = {}) { for (const listener of [...this.listeners.get(type) ?? []]) listener(event); }
  message(value: object) { this.emit("message", { data: JSON.stringify(value) }); }
  send(data: unknown) { const value = JSON.parse(String(data)); this.sent.push(value); this.receive(value, this); }
  close() { this.closed++; this.readyState = 3; this.emit("close"); }
}
const auth = { "voice.ai": { apiKey: "test-key" } };
const common = { text: "Hello" } as const;
const defaults = { model: "voiceai-tts-v1-latest", language: "en", audio_format: "mp3", temperature: 1, top_p: 0.8 };
function reply(socket: Socket, id: string, audio = "AP+A") {
  socket.message({ context_id: id, audio });
  socket.message({ context_id: id, is_last: true });
  socket.message({ context_id: id, context_closed: true });
}

test("modern default is byte-native streaming with explicit model and language defaults", async () => {
  expect(await Array.fromAsync(dispatch("voice.ai", common, { auth, fetch: async (url, init) => {
    expect(String(url)).toBe("https://dev.voice.ai/api/v1/tts/speech/stream");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json", Accept: "audio/*, application/octet-stream" });
    expect([init?.method, init?.redirect]).toEqual(["POST", "error"]);
    expect(JSON.parse(String(init?.body))).toEqual({ ...defaults, text: "Hello" });
    return new Response(Uint8Array.of(0, 255, 128), { headers: { "content-type": "audio/mpeg" } });
  } }))).toEqual([Uint8Array.of(0, 255, 128), { event: "done" }]);
});

test.each(["stream", "http"] as const)("legacy %s retains the original endpoint and schema", async transport => {
  const result = await Array.fromAsync(synthesize({ ...common, apiVersion: "tts-v2", voice: "cloned", temperature: 0.8, topP: 0.4, output: { format: "pcm" } }, { auth, transport, fetch: async (url, init) => {
    expect(String(url)).toBe("https://api.voice.ai/tts/v2/audio/speech");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Hello", voice: "cloned", audio_format: "pcm", streaming: transport === "stream", temperature: 0.8, top_p: 0.4 });
    return new Response(Uint8Array.of(1));
  } }));
  expect(result).toEqual([Uint8Array.of(1), { event: "done" }]);
});

test("current HTTP preserves custom voice, numeric dictionary version and zero settings", async () => {
  await Array.fromAsync(synthesize({ text: "Hola", model: "auto", language: "es", voice: "owned", pronunciationDictionaries: [{ id: "dictionary", version: 2 }], temperature: 0, topP: 0 }, { auth, transport: "http", baseUrl: "https://proxy.test/voice", fetch: async (url, init) => {
    expect(String(url)).toBe("https://proxy.test/voice/api/v1/tts/speech");
    expect(JSON.parse(String(init?.body))).toEqual({ ...defaults, text: "Hola", model: "voiceai-tts-multilingual-v1-latest", language: "es", voice_id: "owned", dictionary_id: "dictionary", dictionary_version: 2, temperature: 0, top_p: 0 });
    return new Response(Uint8Array.of(1));
  } }));
});

test.each([
  { ...common, model: "voiceai-tts-lite-v1-latest" }, { ...common, model: "voiceai-tts-lite-v1-2026-04-15" },
  { ...common, model: "voiceai-tts-v1-latest" }, { ...common, model: "voiceai-tts-v1-2026-02-10" },
] as const)("hosted model %# uses byte-native HTTP per the current model guide", async request => {
  await Array.fromAsync(synthesize(request, { auth, fetch: async (url, init) => {
    expect(String(url)).toBe("https://dev.voice.ai/api/v1/tts/speech/stream");
    expect(JSON.parse(String(init?.body))).toEqual({ ...defaults, model: request.model, text: "Hello" });
    return new Response(Uint8Array.of(1));
  } }));
});

test("socket-only capabilities reject an HTTP override before fetching", async () => {
  let fetched = false;
  await expect(synthesize({ ...common, audioDelivery: "paced", output: { format: "pcm" } }, { auth, transport: "stream", fetch: async () => { fetched = true; return new Response(); } }).next())
    .rejects.toEqual(new TypeError("Voice.ai incremental input and paced delivery require WebSocket"));
  expect(fetched).toBe(false);
});

const outputs: readonly (readonly [NonNullable<Exclude<TtsRequest, { apiVersion: "tts-v2" }>["output"]>, string])[] = [
  [{ format: "mp3" }, "mp3"], [{ format: "mp3", sampleRateHz: 22050 }, "mp3_22050_32"], [{ format: "mp3", sampleRateHz: 24000 }, "mp3_24000_48"],
  ...([32000, 64000, 96000, 128000, 192000] as const).flatMap(bitRateBps => [
    [{ format: "mp3", sampleRateHz: 44100, bitRateBps }, `mp3_44100_${bitRateBps / 1000}`] as const,
    [{ format: "opus", bitRateBps }, `opus_48000_${bitRateBps / 1000}`] as const,
  ]),
  ...([8000, 16000, 22050, 24000, 32000, 44100, 48000] as const).map(sampleRateHz => [{ format: "pcm", sampleRateHz }, `pcm_${sampleRateHz}`] as const),
  ...([16000, 22050, 24000, 32000] as const).map(sampleRateHz => [{ format: "wav", sampleRateHz }, sampleRateHz === 32000 ? "wav" : `wav_${sampleRateHz}`] as const),
  [{ format: "mulaw" }, "ulaw_8000"], [{ format: "alaw" }, "alaw_8000"],
];
test.each(outputs)("output %# maps orthogonal format, rate and bitrate", async (output, native) => {
  await Array.fromAsync(synthesize({ ...common, output }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body)).audio_format).toBe(native); return new Response(Uint8Array.of(1));
  } }));
});

test.each([
  { ...common, model: "voiceai-tts-v1-latest", language: "fr" },
  { ...common, model: "voiceai-tts-lite-v1-latest", language: "auto" },
  { ...common, model: "voiceai-tts-multilingual-v1-latest" },
  { ...common, model: "voiceai-tts-multilingual-v1-latest", language: "en" },
  { ...common, audioDelivery: "paced", output: { format: "mp3" } },
  { ...common, temperature: NaN }, { ...common, temperature: 2.1 }, { ...common, topP: -0.1 },
  { ...common, pronunciationDictionaries: [] }, { ...common, pronunciationDictionaries: [{ id: "a" }, { id: "b" }] },
  { ...common, pronunciationDictionaries: [{ version: 2 }] }, { ...common, pronunciationDictionaries: [{ id: "a", version: 1.5 }] },
  { ...common, pronunciationDictionaries: [{ id: "a", version: 0 }] }, { ...common, pronunciationDictionaries: [{ id: "a", versionId: "2" }] },
  { ...common, output: { format: "mp3", sampleRateHz: 22050, bitRateBps: 64000 } },
  { ...common, output: { format: "opus" } }, { ...common, output: { format: "pcm", sampleRateHz: 96000 } },
  { ...common, apiVersion: "tts-v2", voice: "owned", model: "v1" },
  { ...common, apiVersion: "tts-v2", voice: "owned", output: { format: "pcm", sampleRateHz: 32000 } },
  { ...common, apiVersion: "tts-v2", voice: "owned", temperature: 0 },
])( "schema rejects unsupported combination %#", request => {
  expect(() => validateRequest(request)).toThrow(new TypeError("Invalid voice.ai TTS request"));
});

test("HTTP delivers before EOF and closes on early consumer exit", async () => {
  let canceled = 0;
  const stream = synthesize(common, { auth, fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.of(1, 2)); }, cancel() { canceled++; },
  })) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  await stream.return?.(); expect(canceled).toBe(1);
});

test("HTTP failure is not read; wrong content and empty responses fail", async () => {
  let reads = 0; let canceled = 0;
  await expect(synthesize(common, { auth, fetch: async () => new Response(new ReadableStream({ pull() { reads++; }, cancel() { canceled++; } }, { highWaterMark: 0 }), { status: 401 }) }).next()).rejects.toEqual(new VoiceAiError(401, null));
  expect([reads, canceled]).toEqual([0, 1]);
  for (const [response, message] of [
    [new Response("{}", { headers: { "content-type": "application/json" } }), "Voice.ai returned an unexpected audio content type"],
    [new Response(null), "Voice.ai returned no audio body"],
    [new Response(new Uint8Array()), "Voice.ai returned no audio bytes"],
  ] as const) await expect(Array.fromAsync(synthesize(common, { auth, fetch: async () => response }))).rejects.toEqual(new TypeError(message));
});

test("abort before headers reclaims a late response and abort after audio prevents done", async () => {
  const controller = new AbortController(); const gate = Promise.withResolvers<Response>(); let canceled = 0;
  const pending = synthesize(common, { auth, signal: controller.signal, fetch: () => gate.promise }).next();
  controller.abort(new Error("stop")); await expect(pending).rejects.toEqual(new Error("stop"));
  gate.resolve(new Response(new ReadableStream({ cancel() { canceled++; } })));
  await Promise.resolve(); await Promise.resolve(); expect(canceled).toBe(1);
  const second = new AbortController(); const stream = synthesize(common, { auth, signal: second.signal, fetch: async () => new Response(Uint8Array.of(1)) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1) }); second.abort(new Error("stop audio"));
  await expect(stream.next()).rejects.toEqual(new Error("stop audio"));
});

test("WebSocket Lite uses native settings and requires separate flush and close acknowledgments", async () => {
  const socket = new Socket((message, socket) => { if (message.flush) reply(socket, message.context_id); });
  const result = await Array.fromAsync(synthesize({ ...common, model: "voiceai-tts-lite-v1-latest", voice: "cloned", audioDelivery: "paced", output: { format: "pcm", sampleRateHz: 16000 }, temperature: 0, topP: 0 }, { auth, webSocket: socket }));
  const id = socket.sent[0]!.context_id;
  expect(socket.sent).toEqual([
    { ...defaults, context_id: id, text: "Hello", voice_id: "cloned", model: "voiceai-tts-lite-v1-latest", audio_format: "pcm_16000", temperature: 0, top_p: 0, delivery_mode: "paced" },
    { context_id: id, text: "", flush: true, auto_close: true },
  ]);
  expect(result).toEqual([{ correlation: "ordered", correlationId: id, audio: Uint8Array.of(0, 255, 128), timestamps: [] }, { event: "flush", correlationId: id }, { event: "done" }]);
  expect(socket.closed).toBe(1);
});

test("concurrent flush audio keeps its native context instead of arrival-order association", async () => {
  const ids: string[] = [];
  const socket = new Socket((message, socket) => {
    if (message.flush) { ids.push(message.context_id); if (ids.length === 2) { reply(socket, ids[1]!, "Ag=="); reply(socket, ids[0]!, "AQ=="); } }
  });
  async function* input(): AsyncIterableIterator<TtsInput> { yield "first"; yield { command: "flush" }; yield "second"; yield { command: "flush" }; }
  const result = await Array.fromAsync(synthesize({ text: input() }, { auth, webSocket: socket }));
  expect(ids.length).toBe(2);
  expect(result).toEqual([
    { correlation: "ordered", correlationId: ids[1]!, audio: Uint8Array.of(2), timestamps: [] }, { event: "flush", correlationId: ids[1]! },
    { correlation: "ordered", correlationId: ids[0]!, audio: Uint8Array.of(1), timestamps: [] }, { event: "flush", correlationId: ids[0]! }, { event: "done" },
  ]);
});

test("clear discards buffered context, waits for closure, and suppresses late retired audio", async () => {
  let old = "";
  const socket = new Socket((message, socket) => {
    if (message.text === "old") old = message.context_id;
    if (message.close_context) { socket.message({ audio: "AQ==", context_id: old }); socket.message({ context_closed: true, context_id: old }); }
    if (message.flush) { socket.message({ audio: "AQ==", context_id: old }); reply(socket, message.context_id, "Ag=="); }
  });
  async function* input(): AsyncIterableIterator<TtsInput> { yield "old"; yield { command: "clear" }; yield "fresh"; }
  const result = await Array.fromAsync(synthesize({ text: input() }, { auth, webSocket: socket }));
  const fresh = socket.sent.find(message => message.text === "fresh")!.context_id;
  expect(result).toEqual([{ event: "clear" }, { correlation: "ordered", correlationId: fresh, audio: Uint8Array.of(2), timestamps: [] }, { event: "flush", correlationId: fresh }, { event: "done" }]);
  expect(socket.sent.filter(message => message.close_context)).toEqual([{ context_id: old, close_context: true }]);
});

test("in-flight clear is local suppression until auto-close, not a forged native cancel", async () => {
  let old = "";
  const socket = new Socket((message, socket) => {
    if (message.text === "old") old = message.context_id;
    if (message.text === "fresh") reply(socket, old, "AQ==");
    if (message.flush && message.context_id !== old) reply(socket, message.context_id, "Ag==");
  });
  async function* input(): AsyncIterableIterator<TtsInput> { yield "old"; yield { command: "flush" }; yield { command: "clear" }; yield "fresh"; }
  const result = await Array.fromAsync(synthesize({ text: input() }, { auth, webSocket: socket }));
  const fresh = socket.sent.find(message => message.text === "fresh")!.context_id;
  expect(result).toEqual([{ event: "clear" }, { correlation: "ordered", correlationId: fresh, audio: Uint8Array.of(2), timestamps: [] }, { event: "flush", correlationId: fresh }, { event: "done" }]);
  expect(socket.sent.filter(message => message.close_context)).toEqual([]);
});

test("incremental items use generated validation, never interpreting update as clear", async () => {
  const socket = new Socket(); let returned = false;
  async function* input() { try { yield { command: "update" }; } finally { returned = true; } }
  await expect(Array.fromAsync(synthesize({ text: input() } as TtsRequest, { auth, webSocket: socket }))).rejects.toEqual(new TypeError("Invalid voice.ai TTS input item"));
  expect(socket.sent).toEqual([]); expect(returned).toBe(true); expect(socket.closed).toBe(1);
});

test("stalled producers do not prevent server failure or abort cleanup", async () => {
  let returned = 0; const socket = new Socket(); const acquired = Promise.withResolvers<void>();
  const input: AsyncIterable<string> = { [Symbol.asyncIterator]() { acquired.resolve(); return { next: () => new Promise(() => {}), return() { returned++; return new Promise(() => {}); } }; } };
  const pending = synthesize({ text: input }, { auth, webSocket: socket }).next(); await acquired.promise;
  socket.message({ error: "private provider details" }); await expect(pending).rejects.toEqual(new VoiceAiError(null, null));
  expect(returned).toBe(1); expect(socket.closed).toBe(1);
  const controller = new AbortController(); const second = new Socket();
  const stopped = synthesize({ text: input }, { auth, webSocket: second, signal: controller.signal }).next();
  controller.abort(new Error("stop")); await expect(stopped).rejects.toEqual(new Error("stop")); expect(second.closed).toBeGreaterThanOrEqual(1);
});

test.each([
  [{ is_last: true }, "Voice.ai omitted context_id"], [{ context_id: "unknown", audio: "AQ==" }, "Voice.ai returned an unknown or completed context"],
  [{ audio: "??", context_id: "id" }, "Invalid Voice.ai base64 audio"], [{ audio: "AR==", context_id: "id" }, "Invalid Voice.ai base64 audio"],
  [{ is_last: false, context_id: "id" }, "Invalid Voice.ai completion flag"], [{ audio: "AQ==", is_last: true, context_id: "id" }, "Invalid Voice.ai message variant"],
] as const)("malformed WebSocket message %# fails closed", async (message, error) => {
  const socket = new Socket((_request, socket) => socket.message(message));
  await expect(Array.fromAsync(synthesize(common, { auth, webSocket: socket }))).rejects.toEqual(new TypeError(error));
  expect(socket.closed).toBeGreaterThanOrEqual(1);
});

test("context closure cannot substitute for is_last and empty completion cannot fabricate audio", async () => {
  for (const kind of ["context_closed", "is_last"] as const) {
    const socket = new Socket((message, socket) => { if (message.flush) socket.message({ context_id: message.context_id, [kind]: true }); });
    await expect(Array.fromAsync(synthesize(common, { auth, webSocket: socket }))).rejects.toEqual(new TypeError(kind === "context_closed" ? "Voice.ai context closed before flush completion" : "Voice.ai returned an unexpected or empty flush completion"));
  }
});

test("abort while the consumer holds an audio chunk releases input immediately", async () => {
  let reads = 0; let returned = 0;
  const input: AsyncIterable<TtsInput> = { [Symbol.asyncIterator]() { return {
    next: async () => ++reads === 1 ? { done: false, value: "Hello" } : reads === 2 ? { done: false, value: { command: "flush" } } : new Promise(() => {}),
    return() { returned++; return new Promise(() => {}); },
  }; } };
  const socket = new Socket((message, socket) => { if (message.flush) socket.message({ context_id: message.context_id, audio: "AQ==" }); });
  const controller = new AbortController();
  const stream = synthesize({ text: input }, { auth, webSocket: socket, signal: controller.signal });
  expect((await stream.next()).value).toEqual({ correlation: "ordered", correlationId: socket.sent[0]!.context_id, audio: Uint8Array.of(1), timestamps: [] });
  controller.abort(new Error("stop")); expect(returned).toBe(1);
  await expect(stream.next()).rejects.toEqual(new Error("stop")); expect(returned).toBe(1);
});

test("producer failure and acquisition errors retain identity and release the socket", async () => {
  const failure = new Error("producer");
  const socket = new Socket();
  async function* input() { yield "Hello"; throw failure; }
  await expect(Array.fromAsync(synthesize({ text: input() }, { auth, webSocket: socket }))).rejects.toBe(failure);
  expect(socket.closed).toBe(1);
  const second = new Socket();
  const unavailable: AsyncIterable<string> = { [Symbol.asyncIterator]() { throw failure; } };
  await expect(synthesize({ text: unavailable }, { auth, webSocket: second }).next()).rejects.toBe(failure);
  expect(second.closed).toBe(1);
});

test("socket binary input, frame bounds and premature closure fail explicitly", async () => {
  for (const [action, error] of [
    [(socket: Socket) => socket.emit("message", { data: new Uint8Array() }), "Voice.ai expected a JSON text frame"],
    [(socket: Socket) => socket.emit("message", { data: "x".repeat(9) }), "Voice.ai message exceeds maxMessageBytes"],
    [(socket: Socket) => socket.emit("close"), "Voice.ai closed before input and contexts completed"],
  ] as const) {
    const socket = new Socket((_message, socket) => action(socket));
    await expect(Array.fromAsync(synthesize(common, { auth, webSocket: socket, maxMessageBytes: 8 }))).rejects.toEqual(new TypeError(error));
  }
});

test("zero timeout and invalid boundary configuration fail before network access", async () => {
  let fetched = false;
  const fetch = async () => { fetched = true; return new Response(); };
  await expect(synthesize(common, { auth, fetch, timeoutMs: 0 }).next()).rejects.toEqual(new DOMException("Voice.ai synthesis timed out", "TimeoutError"));
  for (const maxMessageBytes of [0, -1, Infinity, 0.5]) await expect(synthesize(common, { auth, fetch, maxMessageBytes }).next()).rejects.toEqual(new TypeError("Voice.ai maxMessageBytes must be a positive safe integer"));
  await expect(synthesize(common, { auth, fetch, baseUrl: "https://user:password@voice.test" }).next()).rejects.toEqual(new TypeError("Voice.ai baseUrl must be an HTTP or WebSocket base without credentials, query or fragment"));
  expect(fetched).toBe(false);
});
