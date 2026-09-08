import { expect, expectTypeOf, test } from "bun:test";
import assert from "node:assert/strict";
import { HumeError, synthesize, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import { validateRequest } from "../../generated/validators/hume.ts";
import type { WebSocketLike } from "../../websocket.ts";

const common = { model: "octave-2", voice: "saved-voice", output: { format: "pcm" } } as const;
const auth = { hume: { apiKey: "test-private-key" } };

function validationError(request: unknown): TypeError {
  try { validateRequest(request); } catch (error) {
    assert(error instanceof TypeError);
    return error;
  }
  assert.fail("Expected the generated validator to reject this request");
}

test("Hume error decoding strips one leading BOM and preserves split Unicode", async () => {
  const bytes = new TextEncoder().encode('\uFEFF{"code":"denied","message":"refusé\uFEFF"}');
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const error = await synthesize({ ...common, text: "Hello" }, { auth, fetch: async () => new Response(body, { status: 403 }) }).next().catch(error => error);
  expect(error).toEqual(new HumeError("refusé\uFEFF", 403, "denied"));
  expect(body.locked).toBe(false);
});

test("Hume retains the content check for a singleton empty generation ID", async () => {
  const fetch = async () => { throw new Error("unexpected network"); };
  await expect(synthesize({ ...common, text: "Hello", contextBefore: { requestIds: [""] } }, { auth, fetch }).next())
    .rejects.toEqual(new TypeError("Hume continuation requires a non-empty generation ID"));
});
async function* input(...values: (string | { readonly command: "flush" })[]) { yield* values; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const audio = { type: "audio", audio: "AQI=", audio_format: "pcm", chunk_index: 0, generation_id: "generation", is_last_chunk: true, request_id: "request", snippet_id: "snippet", text: "Hi", transcribed_text: null, utterance_index: 0 };
const timestamp = { type: "timestamp", generation_id: "generation", request_id: "request", snippet_id: "snippet", timestamp: { type: "word", text: "Hi", time: { begin: 10, end: 90 } } };
const ids = { correlation: "timeline", correlationId: "snippet", generationId: "generation", requestId: "request" } as const;
class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = false;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  onSend: (value: Record<string, any>) => void = value => { if (value.text !== undefined) this.binary(Uint8Array.of(1, 2)); if (value.close) this.close(); };
  send(data: unknown) { expect(typeof data).toBe("string"); const value = JSON.parse(data as string); this.sent.push(value); this.onSend(value); }
  close(code = 1000) { this.closed = true; this.readyState = 3; this.emit("close", { code }); }
  addEventListener(type: string, listener: (event: any) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
  binary(value: Uint8Array) { this.emit("message", { data: value }); }
}

test("HTTP streams raw bytes before EOF with resolved settings and an existing custom voice", async () => {
  const end = deferred<void>();
  const result = synthesize({ ...common, text: "Hi", temperature: 0.1, speed: 0.25, trailingSilenceMs: 5000, splitTurns: false, contextBefore: { requestIds: ["previous"] } }, {
    auth, baseUrl: "https://proxy.invalid/hume/?tenant=one", fetch: async (url, init) => {
      expect(String(url)).toBe("https://proxy.invalid/hume/v0/tts/stream/file?tenant=one");
      expect(init?.method).toBe("POST"); expect(init?.headers).toEqual({ "X-Hume-Api-Key": "test-private-key", "content-type": "application/json" });
      expect(JSON.parse(init?.body as string)).toEqual({ utterances: [{ text: "Hi", voice: { id: "saved-voice", provider: "CUSTOM_VOICE" }, speed: 0.25, trailing_silence: 5 }],
        context: { generation_id: "previous" }, version: "2", format: { type: "pcm" }, include_timestamp_types: [], num_generations: 1, split_utterances: false, strip_headers: true, temperature: 0.1, instant_mode: true });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); void end.promise.then(() => { controller.enqueue(Uint8Array.of(2)); controller.close(); }); } }));
    },
  });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1) }); end.resolve();
  expect(await Array.fromAsync(result)).toEqual([Uint8Array.of(2)]);
});

test.each(["mp3", "pcm", "wav"] as const)("HTTP selects %s without inventing sample-rate controls", async format => {
  let body: any;
  expect(await Array.fromAsync(synthesize({ ...common, text: "Hi", output: { format } }, { auth, fetch: async (_, init) => { body = JSON.parse(init?.body as string); return new Response(Uint8Array.of(1)); } }))).toEqual([Uint8Array.of(1)]);
  expect(body.format).toEqual({ type: format });
});

test("Octave 1 voice design and named-voice acting directions remain separate", async () => {
  const requests: unknown[] = [];
  const fetch = async (_: unknown, init?: RequestInit) => { requests.push(JSON.parse(init?.body as string)); return new Response(Uint8Array.of(1)); };
  await Array.fromAsync(synthesize({ model: "octave-1", text: "Hi", voiceDescription: "A warm narrator", output: { format: "wav" } }, { auth, fetch }));
  await Array.fromAsync(synthesize({ model: "octave-1", text: "Hi", voiceName: "Ava", voiceSource: "catalog", instructions: "Whisper", output: { format: "wav" } }, { auth, fetch }));
  expect(requests).toEqual([
    { utterances: [{ text: "Hi", description: "A warm narrator", speed: 1, trailing_silence: 0 }], version: "1", format: { type: "wav" }, include_timestamp_types: [], num_generations: 1, split_utterances: true, strip_headers: true, instant_mode: false },
    { utterances: [{ text: "Hi", voice: { name: "Ava", provider: "HUME_AI" }, description: "Whisper", speed: 1, trailing_silence: 0 }], version: "1", format: { type: "wav" }, include_timestamp_types: [], num_generations: 1, split_utterances: true, strip_headers: true, instant_mode: true },
  ]);
});

test("dialogue and reference turns preserve per-turn delivery and speaker selection", async () => {
  let body: any;
  await Array.fromAsync(synthesize({ model: "octave-1", output: { format: "mp3" }, speed: 1.2,
    speakers: [{ alias: "a", voice: "private" }, { alias: "b", voiceName: "Ava", voiceSource: "catalog" }],
    turns: [{ speaker: "a", text: "Hello", instructions: "Happy", trailingSilenceMs: 250 }, { speaker: "b", text: "Hi", speed: 0.9 }],
    contextBefore: { turns: [{ speaker: "b", text: "Before", instructions: "Calm" }] },
  }, { auth, fetch: async (_, init) => { body = JSON.parse(init?.body as string); return new Response(Uint8Array.of(1)); } }));
  expect(body.utterances).toEqual([{ text: "Hello", voice: { id: "private", provider: "CUSTOM_VOICE" }, description: "Happy", speed: 1.2, trailing_silence: 0.25 }, { text: "Hi", voice: { name: "Ava", provider: "HUME_AI" }, speed: 0.9, trailing_silence: 0 }]);
  expect(body.context).toEqual({ utterances: [{ text: "Before", voice: { name: "Ava", provider: "HUME_AI" }, description: "Calm", speed: 1.2, trailing_silence: 0 }] });
});

test("JSON timestamps preserve snippet identity independently of audio arrival and aggregate snippets", async () => {
  const other = { ...timestamp, snippet_id: "other", timestamp: { type: "phoneme", text: "m", time: { begin: 20, end: 40 } } };
  const aggregate = { ...audio, snippet: { audio: "AwQ=", timestamps: [timestamp.timestamp] } };
  const result = await Array.fromAsync(synthesize({ ...common, text: "Hi", timestampGranularity: ["word", "phoneme"] as const }, { auth, fetch: async (url, init) => {
    expect(new URL(String(url)).pathname).toBe("/v0/tts/stream/json"); expect(JSON.parse(init?.body as string).include_timestamp_types).toEqual(["word", "phoneme"]);
    return new Response([other, aggregate, timestamp].map(value => JSON.stringify(value)).join("\n"));
  } }));
  expect(result).toEqual([
    { ...ids, correlationId: "other", timestamps: [{ kind: "phoneme", value: "m", startTimeMs: 20, endTimeMs: 40 }] },
    { ...ids, audio: Uint8Array.of(1, 2), timestamps: [], chunkIndex: 0, isLastChunk: true, inputGroupId: "0" },
    { ...ids, timestamps: [{ kind: "word", value: "Hi", startTimeMs: 10, endTimeMs: 90 }] },
  ]);
});

test("metadata alone exposes a generation ID for later continuation, including Octave 1", async () => {
  const result = await Array.fromAsync(synthesize({ ...common, model: "octave-1", text: "Hi" }, { auth, includeMetadata: true, fetch: async (url) => {
    expect(new URL(String(url)).pathname).toBe("/v0/tts/stream/json"); return new Response(JSON.stringify(audio));
  } }));
  expect(result).toEqual([{ ...ids, audio: Uint8Array.of(1, 2), timestamps: [], chunkIndex: 0, isLastChunk: true, inputGroupId: "0" }]);
});

test("socket input streams bytes before producer completion and supports flush without an invented acknowledgement", async () => {
  const socket = new Socket(); const resume = deferred<void>();
  const text = (async function* () { yield "Hel"; await resume.promise; yield "lo"; yield { command: "flush" as const }; })();
  const result = synthesize({ ...common, text }, { webSocket: socket });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  expect(socket.sent).toEqual([{ text: "Hel", voice: { id: "saved-voice", provider: "CUSTOM_VOICE" }, speed: 1, trailing_silence: 0 }]);
  resume.resolve(); expect(await Array.fromAsync(result)).toEqual([Uint8Array.of(1, 2)]);
  expect(socket.sent.slice(1)).toEqual([{ text: "lo", voice: { id: "saved-voice", provider: "CUSTOM_VOICE" }, speed: 1, trailing_silence: 0 }, { flush: true }, { close: true }]);
  expect(socket.closed).toBe(true); expect([...socket.listeners.values()].map(set => set.size)).toEqual([0, 0, 0, 0]);
});

test("binary mode ignores a metadata copy of audio", async () => {
  const socket = new Socket(); socket.onSend = value => { if (value.text) { socket.binary(Uint8Array.of(9)); socket.receive(audio); } if (value.close) socket.close(); };
  expect(await Array.fromAsync(synthesize({ ...common, text: input("Hi") }, { webSocket: socket }))).toEqual([Uint8Array.of(9)]);
});

test("socket dialogue can change voice, speed, pause and acting directions on each turn", async () => {
  const socket = new Socket();
  const turns = (async function* () { yield { speaker: "a", text: "Hi", instructions: "Whisper" }; yield { command: "flush" as const }; yield { speaker: "b", text: "Bye", speed: 3, trailingSilenceMs: 5000 }; })();
  await Array.fromAsync(synthesize({ model: "octave-1", output: { format: "pcm" }, speakers: [{ alias: "a", voice: "first" }, { alias: "b", voiceName: "Second" }], turns }, { webSocket: socket }));
  expect(socket.sent).toEqual([{ text: "Hi", voice: { id: "first", provider: "CUSTOM_VOICE" }, description: "Whisper", speed: 1, trailing_silence: 0 }, { flush: true }, { text: "Bye", voice: { name: "Second", provider: "CUSTOM_VOICE" }, speed: 3, trailing_silence: 5 }, { close: true }]);
});

test("socket JSON mode preserves independent timestamps and native generation metadata", async () => {
  const socket = new Socket(); socket.onSend = value => { if (value.text) { socket.receive(timestamp); socket.receive(audio); } if (value.close) socket.close(); };
  expect(await Array.fromAsync(synthesize({ ...common, text: input("Hi"), timestampGranularity: "word" }, { webSocket: socket }))).toEqual([
    { ...ids, timestamps: [{ kind: "word", value: "Hi", startTimeMs: 10, endTimeMs: 90 }] }, { ...ids, audio: Uint8Array.of(1, 2), timestamps: [], chunkIndex: 0, isLastChunk: true, inputGroupId: "0" },
  ]);
});

test.each([
  { ...common, text: "Hi", instructions: "Whisper" },
  { ...common, model: "octave-1", text: "Hi", timestampGranularity: "word" },
  { ...common, text: "Hi", voiceName: "also" },
  { ...common, text: "Hi", speed: 3.1 },
  { ...common, text: "Hi", trailingSilenceMs: -1 },
  { ...common, text: "Hi", temperature: 0 },
  { ...common, text: "Hi", output: { format: "pcm", sampleRateHz: 24000 } },
  { ...common, text: "Hi", contextBefore: { requestIds: [] } },
  { ...common, text: "Hi", contextBefore: { requestIds: ["a", "b"] } },
  { ...common, text: "x".repeat(5001) },
] as const)("rejects invalid input before network work", async request => {
  let called = false;
  await expect(synthesize(request as unknown as TtsRequest, { auth, fetch: async () => { called = true; throw new Error("Unexpected fetch"); } }).next()).rejects.toEqual(validationError(request));
  expect(called).toBe(false);
});

test("generated guards reject unsupported live input combinations and commands", () => {
  assert.throws(() => validateRequest({ ...common, text: input("Hi"), splitTurns: false }), TypeError);
  assert.throws(() => validateRequest({ ...common, text: input("Hi"), contextBefore: { text: "Before" } }), TypeError);
  const check = validateRequest({ ...common, text: input("Hi") });
  for (const item of [{ command: "clear" }, { command: "update", replacements: [] }]) {
    assert.throws(() => check(item), { name: "TypeError", message: 'Invalid hume TTS input item:\ntext item: expected string\ntext item["command"]: expected "flush"' });
  }
});

test("an oversized live text message is rejected before sending it", async () => {
  const socket = new Socket();
  await expect(synthesize({ ...common, text: input("x".repeat(5001)) }, { webSocket: socket }).next()).rejects.toEqual(new TypeError("Hume text must not exceed 5000 characters per utterance"));
  expect(socket.sent).toEqual([]); expect(socket.closed).toBe(true);
});

test("voice-less Octave 1 keeps native automatic voice design out of instant mode", async () => {
  let body: any;
  await Array.fromAsync(synthesize({ model: "octave-1", text: "Hi", output: { format: "pcm" } }, { auth, fetch: async (_, init) => { body = JSON.parse(init?.body as string); return new Response(Uint8Array.of(1)); } }));
  expect(body.instant_mode).toBe(false); expect(body.utterances).toEqual([{ text: "Hi", speed: 1, trailing_silence: 0 }]);
});

test("speaker references and context cardinality fail before synthesis", async () => {
  const request = { model: "octave-2", output: { format: "pcm" }, speakers: [{ alias: "a", voice: "saved" }], turns: [{ speaker: "missing", text: "Hi" }] } as const;
  await expect(synthesize(request, { auth }).next()).rejects.toEqual(new TypeError("Unknown Hume speaker: missing"));
  await expect(synthesize({ ...request, speakers: [...request.speakers, ...request.speakers] }, { auth }).next()).rejects.toEqual(new TypeError("Hume speaker aliases must be unique"));
  for (const invalid of [{ ...request, turns: [] }, { ...request, turns: [{ speaker: "a", text: "Hi" }], contextBefore: { turns: [] } }]) {
    await expect(synthesize(invalid, { auth, fetch: async () => { throw new Error("Unexpected fetch"); } }).next()).rejects.toEqual(validationError(invalid));
  }
});

test("Octave 2 async turn guards still reject Octave 1 acting directions", async () => {
  const socket = new Socket();
  const turns = (async function* () { yield { speaker: "a", text: "Hi", instructions: "Whisper" }; })();
  await expect(synthesize({ model: "octave-2", output: { format: "pcm" }, speakers: [{ alias: "a", voice: "saved" }], turns } as unknown as TtsRequest, { webSocket: socket }).next()).rejects.toEqual(new TypeError('Invalid hume TTS input item:\nturns item["instructions"]: field is not allowed\nturns item["command"]: required field'));
  expect(socket.sent).toEqual([]); expect(socket.closed).toBe(true);
});

test.each([
  [{ type: "bad" }, "Hume returned invalid correlation identifiers"],
  [{ ...timestamp, timestamp: { type: "word", text: "Hi", time: { begin: 20, end: 10 } } }, "Hume returned an invalid timestamp"],
  [{ ...audio, chunk_index: -1 }, "Hume returned an invalid audio event"],
  [{ ...audio, audio: null }, "Hume returned an invalid audio event"],
] as const)("malformed output is rejected: %j", async (packet, message) => {
  await expect(synthesize({ ...common, text: "Hi", timestampGranularity: "word" }, { auth, fetch: async () => new Response(JSON.stringify(packet)) }).next()).rejects.toEqual(new TypeError(message));
});

test("HTTP and in-stream errors preserve upstream codes and messages", async () => {
  const body = JSON.stringify({ error: "Unavailable", message: "Try later", code: "busy" });
  await expect(synthesize({ ...common, text: "Hi" }, { auth, fetch: async () => new Response(body, { status: 429 }) }).next()).rejects.toEqual(new HumeError("Try later", 429, "busy"));
  await expect(synthesize({ ...common, text: "Hi", timestampGranularity: "word" }, { auth, fetch: async () => new Response(body) }).next()).rejects.toEqual(new HumeError("Try later", null, "busy"));
});

test("upstream errors interrupt stalled input and do not await producer cleanup", async () => {
  const socket = new Socket(); const active = deferred<void>(); let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next() { active.resolve(); return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const result = synthesize({ ...common, text }, { webSocket: socket }); const pending = result.next(); await active.promise;
  socket.receive({ error: "Rejected", code: "bad" });
  await expect(pending).rejects.toEqual(new HumeError("Rejected", null, "bad")); expect(returned).toBe(1); expect(socket.closed).toBe(true);
});

test("abort interrupts socket-open and producer waits", async () => {
  for (const opening of [true, false]) {
    const socket = new Socket(); if (opening) socket.readyState = 0;
    const controller = new AbortController(); let returned = 0;
    const text = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<string>>(() => {}), return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
    const pending = synthesize({ ...common, text }, { webSocket: socket, signal: controller.signal }).next();
    await new Promise(resolve => setTimeout(resolve, 0)); const reason = new Error("Stop"); controller.abort(reason);
    await expect(pending).rejects.toBe(reason); expect(socket.closed).toBe(true); expect(returned).toBe(opening ? 0 : 1);
  }
});

test("early consumer return closes the socket and returns unfinished input", async () => {
  const socket = new Socket(); let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next: async () => ({ done: false as const, value: "Hi" }), return: async () => { returned++; return { done: true as const, value: undefined }; } }; } };
  const result = synthesize({ ...common, text }, { webSocket: socket }); await result.next(); await result.return!();
  expect(returned).toBe(1); expect(socket.closed).toBe(true);
});

test("socket close is completion only after input ends and a successful close code", async () => {
  const early = new Socket(); early.onSend = () => early.close();
  await expect(synthesize({ ...common, text: input("Hi", "Bye") }, { webSocket: early }).next()).rejects.toEqual(new TypeError("Hume WebSocket closed before the input stream ended"));
  const failed = new Socket(); failed.onSend = value => { if (value.close) failed.close(1011); };
  await expect(synthesize({ ...common, text: input("Hi") }, { webSocket: failed }).next()).rejects.toEqual(new HumeError("Hume WebSocket closed with code 1011", null, "1011"));
});

test("whole-operation deadlines interrupt fetch and a stalled body", async () => {
  await expect(synthesize({ ...common, text: "Hi" }, { auth, timeoutMs: 5, fetch: () => new Promise(() => {}) }).next()).rejects.toEqual(new DOMException("Hume synthesis deadline expired", "TimeoutError"));
  let canceled = false;
  await expect(synthesize({ ...common, text: "Hi" }, { auth, timeoutMs: 5, fetch: async () => new Response(new ReadableStream({ cancel() { canceled = true; return new Promise(() => {}); } })) }).next()).rejects.toEqual(new DOMException("Hume synthesis deadline expired", "TimeoutError"));
  expect(canceled).toBe(true);
});

test("dispatch preserves provider-specific model and async input narrowing", () => {
  expectTypeOf(dispatch("hume", { ...common, text: input("Hi") }, { auth })).toEqualTypeOf<ReturnType<typeof synthesize>>();
  if (false) {
    // @ts-expect-error Octave 2 has no acting instructions yet.
    dispatch("hume", { ...common, text: "Hi", instructions: "Whisper" });
    // @ts-expect-error Octave 1 has no timestamps.
    dispatch("hume", { ...common, model: "octave-1", text: "Hi", timestampGranularity: "word" });
    // @ts-expect-error Octave 2 requires a saved voice.
    dispatch("hume", { model: "octave-2", text: "Hi", output: { format: "pcm" } });
    // @ts-expect-error Voice ID and name are alternatives.
    dispatch("hume", { ...common, voiceName: "Ava", text: "Hi" });
    // @ts-expect-error Hume has no clear command.
    dispatch("hume", { ...common, text: (async function* () { yield { command: "clear" as const }; })() });
    // @ts-expect-error Amazon still requires static input.
    dispatch("amazon", { text: input("Hi"), voice: "Joanna", output: { format: "mp3" } });
  }
});
