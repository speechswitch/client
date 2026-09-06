import { expect, test } from "bun:test";
import { synthesize, SmallestError, type TtsInput } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import { validateRequest } from "../../generated/validators/smallest.ai.ts";
import type { WebSocketLike } from "../../websocket.ts";

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
  close() { this.closed++; this.readyState = 3; this.emit("close"); }
}
const auth = { "smallest.ai": { apiKey: "test-key" } };
const common = { model: "lightning-v3.1", voice: "custom_voice", text: "Hello" } as const;
const settings = { voice_id: "custom_voice", model: "lightning_v3.1", language: "auto", sample_rate: 44100, output_format: "pcm", speed: 1, math_notation: false };
const sse = (...values: object[]) => new Response(values.map(value => `event: audio\ndata: ${JSON.stringify(value)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const chunk = { status: "206", done: false, audio: "AP+A" };
const complete = { status: "200", done: true };
function packet(socket: Socket, status: string, extra: object = {}) { socket.message({ status, request_id: "native-1", ...extra }); }
function reply(socket: Socket, extra: object = {}) { packet(socket, "chunk", { data: { audio: "AQI=" }, ...extra }); packet(socket, "complete", extra); }

test.each(["lightning-v3.1", "lightning-v3.1-pro"] as const)("%s uses SSE by default, native model mapping and byte decoding", async model => {
  const request = model === "lightning-v3.1" ? common : { ...common, model: "lightning-v3.1-pro" } as const;
  const result = await Array.fromAsync(dispatch("smallest.ai", request, { auth, baseUrl: "https://example.test/proxy?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://example.test/proxy/waves/v1/tts/live?tenant=one");
    expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json", Accept: "text/event-stream" });
    expect(JSON.parse(String(init?.body))).toEqual({ ...settings, model: model === "lightning-v3.1" ? "lightning_v3.1" : "lightning_v3.1_pro", text: "Hello" });
    return sse(chunk, complete);
  } }));
  expect(result).toEqual([Uint8Array.of(0, 255, 128), { event: "done" }]);
});

test.each(["pcm", "wav", "mp3", "mulaw", "alaw"] as const)("HTTP %s keeps format and sampling independent, with the required Accept header", async format => {
  const result = await Array.fromAsync(synthesize({ ...common, model: "lightning-v3.1-pro", language: "ja", numberPronunciationLanguage: "hi",
    output: { format, sampleRateHz: 8000 }, formulaReading: "plain_text", speed: 0.5, contentRetentionDays: 7,
    pronunciationDictionaries: [{ id: "dictionary" }], sessionId: "session.1", requestId: "request-1" }, { auth, transport: "http", fetch: async (url, init) => {
    expect(String(url)).toBe("https://api.smallest.ai/waves/v1/tts");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key", "x-expire-content": "true", "Content-Type": "application/json", Accept: "audio/wav" });
    expect(JSON.parse(String(init?.body))).toEqual({ ...settings, model: "lightning_v3.1_pro", language: "ja", number_pronunciation_language: "hi", sample_rate: 8000,
      output_format: format === "mulaw" ? "ulaw" : format, math_notation: true, speed: 0.5, pronunciation_dicts: ["dictionary"], session_id: "session.1", request_id: "request-1", text: "Hello" });
    return new Response(Uint8Array.of(1, 2), { headers: { "content-type": "application/octet-stream" } });
  } }));
  expect(result).toEqual([Uint8Array.of(1, 2), { event: "done" }]);
});

test("whole text is trimmed before generated bounds; Unicode length is code points", async () => {
  const text = "😀".repeat(8000);
  await Array.fromAsync(synthesize({ ...common, text: `  ${text}\n` }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body)).text).toBe(text); return sse(chunk, complete);
  } }));
  await expect(synthesize({ ...common, text: " \n " }, { auth }).next()).rejects.toEqual(new TypeError("Invalid smallest.ai TTS request"));
});

test("SSE delivers audio before EOF, preserves terminal audio, and closes on consumer return", async () => {
  let canceled = 0;
  const stream = synthesize(common, { auth, fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(`: heartbeat\r\nevent: audio\r\ndata: ${JSON.stringify(chunk)}\r\n\r\n`)); }, cancel() { canceled++; },
  }), { headers: { "content-type": "text/event-stream" } }) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(0, 255, 128) });
  await stream.return?.(); expect(canceled).toBe(1);
  expect(await Array.fromAsync(synthesize(common, { auth, fetch: async () => sse({ ...complete, audio: "AQI=" }) }))).toEqual([Uint8Array.of(1, 2), { event: "done" }]);
});

test.each([
  [sse(chunk), "Smallest.ai SSE ended before completion"],
  [sse(complete), "Smallest.ai returned no audio"],
  [sse({ done: false, status: "200" }), "Invalid Smallest.ai SSE status"],
  [sse({ done: true, status: "206" }), "Invalid Smallest.ai SSE status"],
  [sse({ done: false, status: "206" }), "Smallest.ai SSE chunk omitted audio"],
  [sse({ ...chunk, audio: "AR==" }), "Invalid Smallest.ai base64 audio"],
  [sse({ ...chunk, audio: "??" }), "Invalid Smallest.ai base64 audio"],
  [new Response("{}", { headers: { "content-type": "application/json" } }), "Smallest.ai returned an unexpected content type"],
  [new Response(null, { status: 204 }), "Smallest.ai returned no audio body"],
] as const)("SSE rejects malformed or incomplete responses %#", async (response, message) => {
  await expect(Array.fromAsync(synthesize(common, { auth, fetch: async () => response }))).rejects.toEqual(new TypeError(message));
});

test("HTTP failures do not read or expose error bodies", async () => {
  let read = 0; let canceled = 0;
  await expect(synthesize(common, { auth, fetch: async () => new Response(new ReadableStream({ pull() { read++; }, cancel() { canceled++; } }, { highWaterMark: 0 }), { status: 401 }) }).next())
    .rejects.toEqual(new SmallestError("Smallest.ai returned HTTP 401", 401));
  expect(read).toBe(0); expect(canceled).toBe(1);
});

test("abort before headers reclaims a late response; abort during audio prevents done", async () => {
  const controller = new AbortController(); const gate = Promise.withResolvers<Response>(); let canceled = 0;
  const result = synthesize(common, { auth, signal: controller.signal, fetch: () => gate.promise }).next();
  controller.abort(new Error("stop")); await expect(result).rejects.toEqual(new Error("stop"));
  gate.resolve(new Response(new ReadableStream({ cancel() { canceled++; } }))); await Promise.resolve(); await Promise.resolve(); expect(canceled).toBe(1);
  const second = new AbortController();
  const stream = synthesize(common, { auth, signal: second.signal, fetch: async () => sse(chunk, complete) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(0, 255, 128) });
  second.abort(new Error("stop audio")); await expect(stream.next()).rejects.toEqual(new Error("stop audio"));
});

test("WebSocket timestamps remain independent, use native identity and preserve original word indices", async () => {
  const socket = new Socket((_message, socket) => {
    packet(socket, "word_timestamp", { data: { id: 3, word: "$100", start: 0, end: 0.25 } }); reply(socket);
  });
  const result = await Array.fromAsync(synthesize({ ...common, voice: "meher", timestampGranularity: "word", requestId: "client-1" }, { auth, webSocket: socket }));
  expect(socket.sent).toEqual([{ ...settings, voice_id: "meher", language: "en", word_timestamps: true, text: "Hello", request_id: "client-1" }]);
  expect(result).toEqual([
    { correlation: "ordered", correlationId: "native-1", wordIndex: 3, timestamps: [{ kind: "word", value: "$100", startTimeMs: 0, endTimeMs: 250 }] },
    { correlation: "ordered", correlationId: "native-1", audio: Uint8Array.of(1, 2), timestamps: [] }, { event: "done" },
  ]);
  expect(socket.closed).toBe(1); expect([...socket.listeners.values()].map(set => set.size)).toEqual([0, 0, 0, 0]);
});

test("incremental text is sent without look-ahead and final input flushes once", async () => {
  const gate = Promise.withResolvers<void>();
  const socket = new Socket((message, socket) => {
    if (message.text) packet(socket, "chunk", { data: { audio: "AQI=" } });
    if (message.flush) packet(socket, "complete");
  });
  const text = (async function* () { yield "Hello"; await gate.promise; yield " world"; })();
  const stream = synthesize({ ...common, text, maxBufferDelayMs: 0, completionDelayMs: 0, requestId: "client" }, { auth, webSocket: socket });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  expect(socket.sent).toEqual([{ ...settings, text: "Hello", request_id: "client", continue: true, max_buffer_flush_ms: 0, complete_backoff_ms: 0 }]);
  gate.resolve(); expect(await Array.fromAsync(stream)).toEqual([Uint8Array.of(1, 2), { event: "done" }]);
  expect(socket.sent).toEqual([
    { ...settings, text: "Hello", request_id: "client", continue: true, max_buffer_flush_ms: 0, complete_backoff_ms: 0 },
    { ...settings, text: " world", request_id: "client", continue: true, max_buffer_flush_ms: 0, complete_backoff_ms: 0 },
    { ...settings, text: "", request_id: "client", continue: false, flush: true, max_buffer_flush_ms: 0, complete_backoff_ms: 0 },
  ]);
});

test("continuations preserve segment-local identity and never invent final completion", async () => {
  const controller = new AbortController(); const gate = Promise.withResolvers<void>();
  const socket = new Socket((message, socket) => { if (message.text) reply(socket, { request_id: `segment-${socket.sent.length}` }); });
  const text = (async function* () { yield "One."; await gate.promise; yield "Two."; })();
  const stream = synthesize({ ...common, text, continuation: { id: "context", maxBufferDelayMs: 0 } }, { auth, webSocket: socket, signal: controller.signal });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  expect(await stream.next()).toEqual({ done: false, value: { event: "batch", requestId: "segment-1" } });
  gate.resolve(); expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  expect(await stream.next()).toEqual({ done: false, value: { event: "batch", requestId: "segment-2" } });
  const pending = stream.next(); await Promise.resolve(); await Promise.resolve();
  controller.abort(new Error("caller finished")); await expect(pending).rejects.toEqual(new Error("caller finished"));
  expect(socket.sent.at(-1)).toEqual({ context_id: "context", voice_id: "custom_voice", continue: false });
  expect(socket.sent.slice(0, 2).map(({ request_id, ...message }) => message)).toEqual([
    { ...settings, text: "One.", context_id: "context", continue: true, max_buffer_delay_ms: 0 },
    { ...settings, text: "Two.", context_id: "context", continue: true, max_buffer_delay_ms: 0 },
  ]);
});

test("clear discards known stale IDs, keeps fresh frames and has no fabricated ack", async () => {
  const controller = new AbortController(); let stale: string | undefined;
  const socket = new Socket((message, socket) => {
    if (message.text === "old") stale = message.request_id;
    if (message.text === "new") { reply(socket, { external_request_id: stale }); packet(socket, "chunk", { external_request_id: message.request_id, data: { audio: "AwQ=" } }); }
  });
  const text = (async function* (): AsyncGenerator<TtsInput> { yield "old"; yield { command: "clear" }; yield "new"; })();
  const stream = synthesize({ ...common, text, continuation: { id: "context" }, requestId: "client" }, { auth, webSocket: socket, signal: controller.signal });
  expect(await stream.next()).toEqual({ done: false, value: { event: "clear" } });
  expect(socket.sent[1]).toEqual({ context_id: "context", cancel_request: true });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(3, 4) });
  expect(socket.sent[2]!.request_id).not.toBe("client");
  await stream.return?.(); expect(socket.closed).toBe(1);
});

test("clear never advances input after abort and closes a blocked producer once", async () => {
  const controller = new AbortController(); let advanced = 0; let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next() { advanced++; return Promise.resolve({ done: false as const, value: { command: "clear" as const } }); }, return() { returned++; return new Promise<IteratorResult<TtsInput>>(() => {}); } }; } };
  const socket = new Socket(); const stream = synthesize({ ...common, text, continuation: { id: "c" } }, { auth, webSocket: socket, signal: controller.signal });
  expect(await stream.next()).toEqual({ done: false, value: { event: "clear" } });
  controller.abort(new Error("stop")); await expect(stream.next()).rejects.toEqual(new Error("stop"));
  expect(advanced).toBe(1); expect(returned).toBe(1); expect(socket.closed).toBe(1);
});

test.each([
  [{ status: "unexpected", request_id: "r", data: {} }, "Unknown Smallest.ai WebSocket status"],
  [{ status: "chunk", data: { audio: "AQI=" } }, "Invalid Smallest.ai request identity"],
  [{ status: "chunk", request_id: "r", data: { audio: "AR==" } }, "Invalid Smallest.ai base64 audio"],
  [{ status: "word_timestamp", request_id: "r", data: { id: 0, word: "word", start: 1, end: 0 } }, "Invalid Smallest.ai word timestamp"],
] as const)("malformed WebSocket response fails and cleans up %#", async (value, message) => {
  const socket = new Socket((_message, socket) => socket.message(value));
  await expect(Array.fromAsync(synthesize(common, { auth, webSocket: socket }))).rejects.toEqual(new TypeError(message));
  expect(socket.readyState).toBe(3);
});

test("native errors, early completion and early close are failures", async () => {
  const errors = [
    new Socket((_message, socket) => socket.message({ status: "error", message: "timeout" })),
    new Socket((_message, socket) => socket.close()),
  ];
  await expect(synthesize(common, { auth, webSocket: errors[0] }).next()).rejects.toEqual(new SmallestError("timeout"));
  await expect(synthesize(common, { auth, webSocket: errors[1] }).next()).rejects.toEqual(new TypeError("Smallest.ai WebSocket closed before completion"));
  const text = (async function* () { yield "Hi"; await new Promise(() => {}); })();
  await expect(Array.fromAsync(synthesize({ ...common, text }, { auth, webSocket: new Socket((_message, socket) => reply(socket)) }))).rejects.toEqual(new TypeError("Smallest.ai completed before input ended"));
});

test.each([
  { model: "lightning-v2" }, { language: "ja" }, { speed: 0.49 }, { speed: NaN }, { text: "a".repeat(8001) },
  { contentRetentionDays: 0 }, { output: { format: "pcm", sampleRateHz: 22050 } },
  { output: { format: "mp3", sampleEncoding: "signed_integer_16" } }, { sessionId: "spaces forbidden" },
  { voice: "custom", timestampGranularity: "word" }, { voice: "meher", language: "ja", timestampGranularity: "word" },
  { pronunciationDictionaries: [{ id: "d", versionId: "v" }] }, { maxBufferDelayMs: 0 },
])("generated validator rejects unsupported combinations %#", patch => {
  expect(() => validateRequest({ ...common, ...patch })).toThrow(new TypeError("Invalid smallest.ai TTS request"));
});

test("generated stream validators distinguish ordinary input from continuation commands", () => {
  const text = (async function* () { yield "Hi"; })();
  const plain = validateRequest({ ...common, text });
  expect(() => plain({ command: "clear" })).toThrow(new TypeError("Invalid smallest.ai TTS input item"));
  const continued = validateRequest({ ...common, text, continuation: { id: "c" } });
  expect(continued({ command: "clear" })).toBeUndefined();
  expect(() => continued({ command: "flush" })).toThrow(new TypeError("Invalid smallest.ai TTS input item"));
  expect(() => validateRequest({ ...common, text, continuation: { id: "c" }, maxBufferDelayMs: 0 })).toThrow(new TypeError("Invalid smallest.ai TTS request"));
});

test("transport mismatches and continuation deadlines fail before network access", async () => {
  const text = (async function* () { yield "Hi"; })();
  await expect(synthesize({ ...common, text }, { auth, transport: "sse" }).next()).rejects.toEqual(new TypeError("Smallest.ai incremental text, timestamps and socket overrides require WebSocket transport"));
  await expect(synthesize({ ...common, text, continuation: { id: "c" } }, { auth }).next()).rejects.toEqual(new TypeError("Smallest.ai continuations require a signal or deadline; the server has no final context-complete marker"));
  await expect(synthesize({ ...common, pronunciationDictionaries: [] }, { auth, transport: "websocket" }).next()).rejects.toEqual(new TypeError("Smallest.ai pronunciation dictionaries are documented only for HTTP/SSE"));
  await expect(synthesize(common, { auth, timeoutMs: 0 }).next()).rejects.toEqual(new DOMException("Smallest.ai synthesis deadline expired", "TimeoutError"));
});

test.each([undefined, "unrecognized"])("clear rejects ambiguous post-clear identity %s", async identity => {
  const socket = new Socket((message, socket) => { if (message.cancel_request) packet(socket, "chunk", { data: { audio: "AQI=" }, external_request_id: identity }); });
  const text = (async function* (): AsyncGenerator<TtsInput> { yield { command: "clear" }; })();
  const stream = synthesize({ ...common, text, continuation: { id: "c" } }, { auth, webSocket: socket, signal: new AbortController().signal });
  expect(await stream.next()).toEqual({ done: false, value: { event: "clear" } });
  await expect(stream.next()).rejects.toEqual(new TypeError(identity === undefined ? "Smallest.ai omitted external request identity after clear" : "Smallest.ai returned an unknown external request identity after clear"));
});

test("a continuation socket closing after a batch is not final success", async () => {
  const socket = new Socket((message, socket) => { if (message.text) reply(socket); else if (message.continue === false) socket.close(); });
  const text = (async function* () { yield "Hello."; })();
  const stream = synthesize({ ...common, text, continuation: { id: "c" } }, { auth, webSocket: socket, signal: new AbortController().signal });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  await expect(Array.fromAsync(stream)).rejects.toEqual(new TypeError("Smallest.ai continuation closed without a context-complete marker"));
});

test("deadline interrupts pending headers and output waits", async () => {
  await expect(synthesize(common, { auth, timeoutMs: 5, fetch: () => new Promise<Response>(() => {}) }).next()).rejects.toEqual(new DOMException("Smallest.ai synthesis deadline expired", "TimeoutError"));
  const socket = new Socket();
  await expect(synthesize(common, { auth, timeoutMs: 5, webSocket: socket }).next()).rejects.toEqual(new DOMException("Smallest.ai synthesis deadline expired", "TimeoutError"));
  expect(socket.closed).toBe(1);
});

test("empty incremental input completes without asking the server to synthesize empty text", async () => {
  const socket = new Socket(); const text = (async function* () { yield ""; })();
  expect(await Array.fromAsync(synthesize({ ...common, text }, { auth, webSocket: socket }))).toEqual([{ event: "done" }]);
  expect(socket.sent).toEqual([]); expect(socket.closed).toBe(1);
});

test("SSE errors and an unterminated final event cannot become audio or done", async () => {
  await expect(synthesize(common, { auth, fetch: async () => sse({ status: "error", error: { message: "secret response body" } }) }).next()).rejects.toEqual(new SmallestError("Smallest.ai SSE returned an error"));
  const response = new Response(`event: audio\ndata: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(complete)}\n`, { headers: { "content-type": "text/event-stream" } });
  await expect(Array.fromAsync(synthesize(common, { auth, fetch: async () => response }))).rejects.toEqual(new TypeError("Smallest.ai SSE ended before completion"));
});
