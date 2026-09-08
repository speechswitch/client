import { expect, expectTypeOf, test } from "bun:test";
import assert from "node:assert/strict";
import { synthesize, RimeError, type TtsRequest, type TtsInput, type RimeEnvelope } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { validateRequest } from "../../generated/validators/rime.ts";

class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = 0;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  readonly receive: (message: Record<string, any>, socket: Socket) => void;
  constructor(receive: (message: Record<string, any>, socket: Socket) => void = () => {}) { this.receive = receive; }
  addEventListener(type: string, listener: (event: any) => void) { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown = {}) { for (const listener of [...this.listeners.get(type) ?? []]) listener(event); }
  message(value: object) { this.emit("message", { data: JSON.stringify(value) }); }
  send(data: unknown) { const value = JSON.parse(String(data)); this.sent.push(value); this.receive(value, this); }
  close(code = 1000) { this.closed++; this.readyState = 3; this.emit("close", { code, wasClean: code !== 1006 }); }
}
const auth = { rime: { apiKey: "test-key" } };
const common = { model: "coda", text: "Hello", voice: "custom-uuid" } as const;
const base = { speaker: "custom-uuid", modelId: "coda", lang: "en", samplingRate: 24000, timeScaleFactor: 1, text: "Hello" };
function audio(socket: Socket, contextId: string | null, data = "AQI=") { socket.message({ type: "chunk", contextId, data }); }
function done(socket: Socket, contextId: string | null) { socket.message({ type: "done", contextId }); }
function marks(socket: Socket, contextId: string | null) { socket.message({ type: "timestamps", contextId, word_timestamps: { words: ["Hello"], start: [0], end: [0.125] } }); }
function envelope(id: string | null, extra: { readonly audio?: Uint8Array; readonly timestamps?: RimeEnvelope["timestamps"] }): RimeEnvelope { return { correlation: "ordered", timestampOrigin: "synthesis", ...(id === null ? {} : { inputGroupId: id }), timestamps: [], ...extra }; }

test.each([
  ["pcm", "audio/L16"], ["wav", "audio/wav"], ["mp3", "audio/mpeg"],
  ["mulaw", "audio/PCMU"], ["ogg_opus", "audio/ogg;codecs=opus"], ["webm_opus", "audio/webm;codecs=opus"],
] as const)("modern HTTP streams %s with its documented MIME type", async (format, accept) => {
  const result = await Array.fromAsync(dispatch("rime", { ...common, output: { format } }, { auth, baseUrl: "https://example.test/proxy?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://example.test/proxy/v1/rime-tts?tenant=one");
    expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json", Accept: accept });
    expect(JSON.parse(String(init?.body))).toEqual(base);
    return new Response(Uint8Array.of(0, 255, 128), { headers: { "content-type": accept } });
  } }));
  expect(result).toEqual([Uint8Array.of(0, 255, 128), { event: "done" }]);
});

test.each([["pcm", 16000], ["mp3", 22050], ["mulaw", 8000]] as const)("Mist v2 resolves %s defaults and inverse speed without widening formats", async (format, samplingRate) => {
  await Array.fromAsync(synthesize({ model: "mist-v2", text: "Hello", voice: "custom-uuid", language: "es", speed: 2,
    textNormalization: false, textMarkup: { pauses: true, phonemes: true, speeds: [2, 0.5] }, output: { format } }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual({ speaker: "custom-uuid", modelId: "mistv2", lang: "spa", samplingRate,
      speedAlpha: 0.5, noTextNormalization: true, pauseBetweenBrackets: true, phonemizeBetweenBrackets: true, inlineSpeedAlpha: "0.5,2", text: "Hello" });
    return new Response(Uint8Array.of(1));
  } }));
});

test("Mist v3 English uses current pronunciation support and preferred timeScaleFactor", async () => {
  await Array.fromAsync(synthesize({ ...common, model: "mist-v3", speed: 2, textMarkup: { phonemes: true, pauses: false, speeds: [0.5] } }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual({ ...base, modelId: "mistv3", timeScaleFactor: 0.5, phonemizeBetweenBrackets: true, pauseBetweenBrackets: false, inlineSpeedAlpha: "2" });
    return new Response(Uint8Array.of(1));
  } }));
});

test("HTTP yields its first bytes before EOF and consumer return cancels the reader", async () => {
  let canceled = 0;
  const stream = synthesize(common, { auth, fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { canceled++; },
  })) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  await stream.return?.(); expect(canceled).toBe(1);
});

test("HTTP status errors close without consuming or exposing error bodies", async () => {
  let canceled = 0; let read = 0;
  const result = synthesize(common, { auth, fetch: async () => new Response(new ReadableStream({ pull() { read++; }, cancel() { canceled++; } }, { highWaterMark: 0 }), { status: 429 }) });
  await expect(result.next()).rejects.toEqual(new RimeError("Rime returned HTTP 429", 429));
  expect(canceled).toBe(1); expect(read).toBe(0);
});

test.each([
  [new Response(null, { status: 204 }), "Rime returned no audio body"],
  [new Response(Uint8Array.of()), "Rime returned no audio"],
  [new Response("{}", { headers: { "content-type": "application/json" } }), "Rime returned an unexpected content type"],
] as const)("HTTP rejects invalid audio response %#", async (response, message) => {
  await expect(synthesize(common, { auth, fetch: async () => response }).next()).rejects.toEqual(new TypeError(message));
});

test("abort before headers cancels a late response from an uncooperative fetch", async () => {
  const controller = new AbortController(); const response = Promise.withResolvers<Response>(); let canceled = 0;
  const pending = synthesize(common, { auth, signal: controller.signal, fetch: () => response.promise }).next();
  controller.abort(new Error("stop")); await expect(pending).rejects.toEqual(new Error("stop"));
  response.resolve(new Response(new ReadableStream({ cancel() { canceled++; } })));
  await Promise.resolve(); await Promise.resolve(); expect(canceled).toBe(1);
});

test("incremental text is sent before look-ahead completes; done is batch-only until clean EOS", async () => {
  const gate = Promise.withResolvers<void>();
  const socket = new Socket((message, socket) => {
    if (message.text) { audio(socket, message.contextId); done(socket, message.contextId); }
    if (message.operation === "eos") socket.close();
  });
  const text = (async function* () { yield "Hello"; await gate.promise; })();
  const stream = synthesize({ ...common, text }, { auth, webSocket: socket });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  const id = socket.sent[0]!.contextId;
  expect(socket.sent).toEqual([{ text: "Hello", contextId: id }]);
  expect(await stream.next()).toEqual({ done: false, value: { event: "batch", inputGroupId: id } });
  gate.resolve(); expect(await Array.fromAsync(stream)).toEqual([{ event: "done" }]);
  expect(socket.sent).toEqual([{ text: "Hello", contextId: id }, { operation: "eos" }]);
});

test("empty and busy flushes need no one-to-one done acknowledgment", async () => {
  let id = "";
  const socket = new Socket((message, socket) => {
    if (message.text) id = message.contextId;
    if (message.operation === "eos") { audio(socket, id); done(socket, id); socket.close(); }
  });
  const text = (async function* () {
    yield { command: "flush" } as const; yield "First"; yield { command: "flush" } as const;
    yield "Second"; yield { command: "flush" } as const; yield { command: "flush" } as const;
  })();
  expect(await Array.fromAsync(synthesize({ ...common, text, segmentation: "manual" }, { auth, webSocket: socket })))
    .toEqual([Uint8Array.of(1, 2), { event: "batch", inputGroupId: id }, { event: "done" }]);
  expect(socket.sent).toEqual([{ operation: "flush" }, { text: "First", contextId: id }, { operation: "flush" },
    { text: "Second", contextId: id }, { operation: "flush" }, { operation: "flush" }, { operation: "eos" }]);
});

test("timestamps stay synthesis-local even when they precede audio or reset without done", async () => {
  const socket = new Socket((message, socket) => {
    if (message.text) { marks(socket, message.contextId); audio(socket, message.contextId); marks(socket, message.contextId); }
    if (message.operation === "eos") { done(socket, null); socket.close(); }
  });
  const stream = synthesize({ ...common, timestampGranularity: "word" }, { auth, webSocket: socket });
  const result = await Array.fromAsync(stream); const id = socket.sent[0]!.contextId;
  const timestamp = { kind: "word", value: "Hello", startTimeMs: 0, endTimeMs: 125 } as const;
  expect(result).toEqual([envelope(id, { timestamps: [timestamp] }), envelope(id, { audio: Uint8Array.of(1, 2) }),
    envelope(id, { timestamps: [timestamp] }), { event: "batch" }, { event: "done" }]);
});

test("clear sends only native buffer clear and filters old echoed audio and timestamps", async () => {
  const gate = Promise.withResolvers<void>(); let old = "";
  const socket = new Socket((message, socket) => {
    if (message.text === "Old") { old = message.contextId; audio(socket, old); }
    if (message.operation === "clear") { audio(socket, old, "CQk="); marks(socket, old); done(socket, old); }
    if (message.text === "Fresh") { marks(socket, message.contextId); audio(socket, message.contextId); }
    if (message.operation === "eos") socket.close();
  });
  const text = (async function* () { yield "Old"; await gate.promise; yield { command: "clear" } as const; yield "Fresh"; })();
  const stream = synthesize({ ...common, text, timestampGranularity: "word" }, { auth, webSocket: socket });
  expect(await stream.next()).toEqual({ done: false, value: envelope(old, { audio: Uint8Array.of(1, 2) }) });
  gate.resolve(); const rest = await Array.fromAsync(stream); const fresh = socket.sent[2]!.contextId;
  expect(fresh).not.toBe(old);
  expect(rest).toEqual([{ event: "clear" }, envelope(fresh, { timestamps: [{ kind: "word", value: "Hello", startTimeMs: 0, endTimeMs: 125 }] }),
    envelope(fresh, { audio: Uint8Array.of(1, 2) }), { event: "done" }]);
  expect(socket.sent).toEqual([{ text: "Old", contextId: old }, { operation: "clear" }, { text: "Fresh", contextId: fresh }, { operation: "eos" }]);
});

test("empty incremental input cleanly ends without requiring audio or native done", async () => {
  const socket = new Socket((message, socket) => { if (message.operation === "eos") socket.close(); });
  const text = (async function* () {})();
  expect(await Array.fromAsync(synthesize({ ...common, text }, { auth, webSocket: socket }))).toEqual([{ event: "done" }]);
  expect(socket.sent).toEqual([{ operation: "eos" }]);
});

test.each([1006, 1011, 1008])("abnormal EOS close %s is never success", async code => {
  const socket = new Socket((message, socket) => { if (message.operation === "eos") socket.close(code); });
  await expect(Array.fromAsync(synthesize(common, { auth, webSocket: socket }))).rejects.toEqual(new TypeError("Rime WebSocket closed before clean end-of-stream"));
});

test("native error is terminal locally and cleans up a blocked input producer", async () => {
  const started = Promise.withResolvers<void>(); let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next() { started.resolve(); return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const socket = new Socket(); const pending = synthesize({ ...common, text }, { auth, webSocket: socket }).next();
  await started.promise; socket.message({ type: "error", message: "bad voice" });
  await expect(pending).rejects.toEqual(new RimeError("bad voice")); expect(returned).toBe(1); expect(socket.closed).toBe(1);
  expect([...socket.listeners.values()].map(value => value.size)).toEqual([0, 0, 0, 0]);
});

test("abort while yielded clear neither advances input nor reports completion", async () => {
  let next = 0; let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<TtsInput>> { next++; return { done: false, value: { command: "clear" } }; }, async return(): Promise<IteratorResult<TtsInput>> { returned++; return { done: true, value: undefined }; } }; } };
  const socket = new Socket(); const controller = new AbortController();
  const stream = synthesize({ ...common, text }, { auth, webSocket: socket, signal: controller.signal });
  expect(await stream.next()).toEqual({ done: false, value: { event: "clear" } });
  controller.abort(new Error("stop")); await expect(stream.next()).rejects.toEqual(new Error("stop"));
  expect(next).toBe(1); expect(returned).toBe(1); expect(socket.closed).toBe(1);
});

test.each([
  [{ type: "chunk", contextId: null, data: "AB==" }, "Invalid Rime audio response"],
  [{ type: "chunk", contextId: null, data: "AQI" }, "Invalid Rime audio response"],
  [{ type: "chunk", data: "AQI=" }, "Invalid Rime context ID"],
  [{ type: "timestamps", contextId: null, word_timestamps: { words: ["Hi"], start: [], end: [1] } }, "Invalid Rime timestamp arrays"],
  [{ type: "timestamps", contextId: null, word_timestamps: { words: ["Hi"], start: [2], end: [1] } }, "Invalid Rime timestamp interval"],
  [{ type: "unknown", contextId: null }, "Invalid Rime response"],
] as const)("malformed native frame %# fails closed", async (packet, message) => {
  const socket = new Socket((request, socket) => { if (request.text) socket.message(packet); });
  await expect(synthesize(common, { auth, webSocket: socket }).next()).rejects.toEqual(new TypeError(message));
  expect(socket.closed).toBe(1);
});

test.each([
  { ...common, model: "mist-v2", output: { format: "wav" } },
  { ...common, textMarkup: { pauses: true } },
  { ...common, model: "mist-v3", language: "es", textMarkup: { phonemes: false } },
  { ...common, language: "fr", timestampGranularity: "word" },
  { ...common, model: "mist-v2", output: { format: "pcm", sampleRateHz: 3999 } },
  { ...common, output: { format: "pcm", sampleRateHz: 24000.5 } },
  { ...common, speed: 0.39 }, { ...common, voice: "" }, { ...common, text: "" },
  { ...common, text: "😀".repeat(1001) }, { ...common, model: "mist-v3", textNormalization: false },
])("generated schema rejects unsupported combination %# before network work", async request => {
  let called = false;
  let expected: unknown;
  try { validateRequest(request); } catch (error) { expected = error; }
  assert(expected instanceof TypeError);
  await expect(synthesize(request as TtsRequest, { auth, fetch: async () => { called = true; throw new Error("network"); } }).next())
    .rejects.toEqual(expected);
  expect(called).toBe(false);
});

test("generated validator narrows streamed commands and does not acquire input", () => {
  let acquired = false;
  const text = { [Symbol.asyncIterator](): AsyncIterator<TtsInput> { acquired = true; throw new Error("consumed"); } };
  const validate = validateRequest({ ...common, text });
  expect(acquired).toBe(false); validate("Hi"); validate({ command: "clear" }); validate({ command: "flush" });
  assert.throws(() => validate({ command: "update", replacements: [] }), {
    name: "TypeError", message: [
      "Invalid rime TTS input item:",
      "text item: expected string",
      'text item["command"]: expected "clear"',
      'text item["command"]: expected "flush"',
    ].join("\n"),
  });
  expectTypeOf<ReturnType<typeof synthesize>>().toEqualTypeOf<ReturnType<typeof dispatch<"rime">>>();
});

test("unlabeled audio after clear fails rather than being guessed fresh", async () => {
  const socket = new Socket((message, socket) => { if (message.operation === "eos") { audio(socket, null); socket.close(); } });
  const text = (async function* () { yield { command: "clear" } as const; yield "New"; })();
  const stream = synthesize({ ...common, text }, { auth, webSocket: socket });
  expect(await stream.next()).toEqual({ done: false, value: { event: "clear" } });
  await expect(stream.next()).rejects.toEqual(new TypeError("Rime omitted context identity after clear; stale audio cannot be distinguished"));
});

test("clean close before EOS is not successful completion, even after a native batch", async () => {
  const socket = new Socket((message, socket) => { if (message.text) { done(socket, message.contextId); socket.close(); } });
  const text = (async function* () { yield "Hello"; await new Promise(() => {}); })();
  const stream = synthesize({ ...common, text }, { auth, webSocket: socket });
  expect(await stream.next()).toEqual({ done: false, value: { event: "batch", inputGroupId: socket.sent[0]!.contextId } });
  await expect(stream.next()).rejects.toEqual(new TypeError("Rime WebSocket closed before clean end-of-stream"));
});

test("timeout cleans up an uncooperative input and its socket", async () => {
  let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next() { return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const socket = new Socket();
  await expect(synthesize({ ...common, text }, { auth, webSocket: socket, timeoutMs: 5 }).next())
    .rejects.toEqual(new DOMException("Rime synthesis deadline expired", "TimeoutError"));
  expect(returned).toBe(1); expect(socket.closed).toBe(1);
});

test("consumer return after socket audio releases the socket and unfinished producer once", async () => {
  let next = 0; let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<string>> { next++; return { done: false, value: "Hello" }; }, async return(): Promise<IteratorResult<string>> { returned++; return { done: true, value: undefined }; } }; } };
  const socket = new Socket((message, socket) => { if (message.text) audio(socket, message.contextId); });
  const stream = synthesize({ ...common, text }, { auth, webSocket: socket });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  const before = next; await stream.return?.(); expect(next).toBe(before); expect(returned).toBe(1); expect(socket.closed).toBe(1);
});

test("non-English audio does not wait for timestamps that Rime never emits", async () => {
  const socket = new Socket((message, socket) => { if (message.text) audio(socket, message.contextId); if (message.operation === "eos") socket.close(); });
  expect(await Array.fromAsync(synthesize({ ...common, language: "fr", segmentation: "sentence" }, { auth, webSocket: socket })))
    .toEqual([Uint8Array.of(1, 2), { event: "done" }]);
});

test("stream text-frame limits do not cap the length of a multi-utterance connection", async () => {
  const socket = new Socket((message, socket) => { if (message.text) audio(socket, message.contextId); if (message.operation === "eos") socket.close(); });
  const text = (async function* () { yield "😀".repeat(1000); yield { command: "flush" } as const; yield "b".repeat(1000); })();
  expect(await Array.fromAsync(synthesize({ ...common, text }, { auth, webSocket: socket })))
    .toEqual([Uint8Array.of(1, 2), Uint8Array.of(1, 2), { event: "done" }]);
  const bad = (async function* () { yield "😀".repeat(1001); })();
  const rejected = new Socket();
  await expect(synthesize({ ...common, text: bad }, { auth, webSocket: rejected }).next()).rejects.toEqual(new TypeError("Rime WebSocket text frames are limited to 1000 code points"));
  expect(rejected.sent).toEqual([]); expect(rejected.closed).toBe(1);
});

test.each([0, -1, Number.MIN_VALUE])("inline speed conversion rejects non-positive or unrepresentable reciprocals %#", async speed => {
  let called = false;
  await expect(synthesize({ ...common, model: "mist-v3", textMarkup: { speeds: [speed] } }, { auth, fetch: async () => { called = true; throw new Error("network"); } }).next())
    .rejects.toEqual(new TypeError("Rime inline speeds must have a positive finite reciprocal"));
  expect(called).toBe(false);
});
