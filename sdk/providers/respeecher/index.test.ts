import { expect, test } from "bun:test";
import { synthesize, RespeecherError, type TtsInput } from "./index.ts";
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
const auth = { respeecher: { apiKey: "test-key" } };
const settings = { voice: { id: "custom-voice", sampling_params: {} }, output_format: { sample_rate: 22050, encoding: "pcm_f32le" } };
function audio(socket: Socket, context: string, data = "AQI=") { socket.message({ type: "chunk", context_id: context, data }); }
function done(socket: Socket, context: string) { socket.message({ type: "done", context_id: context }); }
function envelope(context: string, data = [1, 2]) { return { correlation: "ordered" as const, correlationId: context, audio: Uint8Array.from(data), timestamps: [] }; }

test("default socket sends text immediately, finalizes without look-ahead, and preserves context", async () => {
  const socket = new Socket((message, socket) => {
    if (message.transcript) audio(socket, message.context_id);
    if (message.continue === false) done(socket, message.context_id);
  });
  const gate = Promise.withResolvers<void>();
  const text = (async function* () { yield "Hi"; await gate.promise; })();
  const result = synthesize({ text, voice: "custom-voice" }, { auth, webSocket: socket });
  const first = await result.next(); const id = socket.sent[0]!.context_id;
  expect(first).toEqual({ done: false, value: envelope(id) });
  expect(socket.sent).toEqual([{ ...settings, context_id: id, transcript: "Hi", continue: true }]);
  gate.resolve();
  expect(await Array.fromAsync(result)).toEqual([{ event: "done" }]);
  expect(socket.sent).toEqual([{ ...settings, context_id: id, transcript: "Hi", continue: true }, { ...settings, context_id: id, transcript: "", continue: false }]);
  expect(socket.closed).toBe(1);
});

test("clear uses native cancel and suppresses stale chunks, done and context errors", async () => {
  const gate = Promise.withResolvers<void>();
  const socket = new Socket((message, socket) => {
    if (message.transcript) audio(socket, message.context_id, message.transcript === "Old" ? "AQI=" : "AwQ=");
    if (message.cancel) {
      audio(socket, message.context_id, "CQk="); done(socket, message.context_id);
      socket.message({ type: "error", context_id: message.context_id, status_code: 499, error: "canceled context" });
    }
    if (message.continue === false) done(socket, message.context_id);
  });
  const text = (async function* () { yield "Old"; await gate.promise; yield { command: "clear" } as const; yield "New"; yield { command: "flush" } as const; })();
  const result = synthesize({ text, voice: "custom-voice" }, { auth, webSocket: socket });
  const first = await result.next(); const old = socket.sent[0]!.context_id;
  expect(first).toEqual({ done: false, value: envelope(old) });
  gate.resolve(); const rest = await Array.fromAsync(result);
  const fresh = socket.sent[2]!.context_id;
  expect(fresh).not.toBe(old);
  expect(rest).toEqual([{ event: "clear" }, envelope(fresh, [3, 4]), { event: "flush", correlationId: fresh, inputGroupId: fresh }, { event: "done" }]);
  expect(socket.sent).toEqual([
    { ...settings, context_id: old, transcript: "Old", continue: true }, { context_id: old, cancel: true },
    { ...settings, context_id: fresh, transcript: "New", continue: true }, { ...settings, context_id: fresh, transcript: "", continue: false },
  ]);
  expect(socket.closed).toBe(1);
});

test("interleaved contexts retain native association instead of arrival-order guesses", async () => {
  let first = "";
  const socket = new Socket((message, socket) => {
    if (message.transcript === "First") first = message.context_id;
    if (message.transcript === "Second") { audio(socket, message.context_id, "AwQ="); audio(socket, first); done(socket, first); }
    if (message.continue === false && message.context_id !== first) done(socket, message.context_id);
  });
  const text = (async function* () { yield "First"; yield { command: "flush" } as const; yield "Second"; })();
  const result = await Array.fromAsync(synthesize({ text, voice: "custom-voice" }, { auth, webSocket: socket }));
  const second = socket.sent[2]!.context_id;
  expect(result).toEqual([envelope(second, [3, 4]), envelope(first), { event: "flush", correlationId: first, inputGroupId: first }, { event: "done" }]);
});

test("clear cancels all unfinished contexts, including those already flushed", async () => {
  const socket = new Socket((message, socket) => {
    if (message.transcript === "Fresh") audio(socket, message.context_id);
    if (message.continue === false && socket.sent.some(value => value.context_id === message.context_id && value.transcript === "Fresh")) done(socket, message.context_id);
  });
  const text = (async function* () { yield "First"; yield { command: "flush" } as const; yield "Second"; yield { command: "clear" } as const; yield "Fresh"; })();
  const result = await Array.fromAsync(synthesize({ text, voice: "custom-voice" }, { auth, webSocket: socket }));
  expect(socket.sent.filter(value => value.cancel)).toEqual([{ context_id: socket.sent[0]!.context_id, cancel: true }, { context_id: socket.sent[2]!.context_id, cancel: true }]);
  expect(result).toEqual([{ event: "clear" }, envelope(socket.sent[5]!.context_id), { event: "done" }]);
});

test("WAV uses byte HTTP, resolves Ukrainian routing, and preserves explicit zero overrides", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const result = await Array.fromAsync(synthesize({ voice: "custom-voice", model: "realtime-tts", language: "uk", text: "йог+урт", output: { format: "wav", sampleRateHz: 24000 }, temperature: 0, topK: 0, topP: 0.5, minP: 0, randomSeed: 0, presencePenalty: 0, frequencyPenalty: 0, repetitionPenalty: 1 }, {
    auth, fetch: async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(Uint8Array.of(1, 2), { headers: { "content-type": "audio/wav" } }); },
  }));
  expect(result).toEqual([Uint8Array.of(1, 2), { event: "done" }]);
  expect(calls.length).toBe(1); expect(calls[0]!.url).toBe("https://api.respeecher.com/v1/public/tts/ua-rt/tts/bytes");
  expect(calls[0]!.init.headers).toEqual({ "X-API-Key": "test-key", "Content-Type": "application/json" });
  expect(calls[0]!.init.redirect).toBe("error");
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ transcript: "йог+урт", voice: { id: "custom-voice", sampling_params: { seed: 0, temperature: 0, top_k: -1, top_p: 0.5, min_p: 0, presence_penalty: 0, frequency_penalty: 0, repetition_penalty: 1 } }, output_format: { sample_rate: 24000 } });
});

test.each([
  [{ format: "pcm", sampleEncoding: "signed_integer_16" }, "pcm_s16le"],
  [{ format: "mulaw" }, "pcm_mulaw"],
  [undefined, "pcm_f32le"],
] as const)("HTTP streaming uses JSONL, not SSE framing, for %#", async (output, encoding) => {
  let body: unknown;
  const result = await Array.fromAsync(synthesize({ voice: "custom-voice", text: "Hello", output }, { auth, transport: "http", baseUrl: "https://example.invalid/proxy?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://example.invalid/proxy/tts/sse?tenant=one"); body = JSON.parse(String(init?.body));
    return new Response(new ReadableStream({ start(controller) {
      for (const piece of ['{"type":"chunk","data":"A', 'QI="}\r\n\n{"type":"chunk",', '"data":"AwQ="}']) controller.enqueue(new TextEncoder().encode(piece));
      controller.close();
    } }), { headers: { "content-type": "text/event-stream" } });
  } }));
  expect(body).toEqual({ transcript: "Hello", voice: settings.voice, output_format: { sample_rate: 22050, encoding } });
  expect(result).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3, 4), { event: "done" }]);
});

test("JSONL returns the first chunk before EOF and cancels unread response on early exit", async () => {
  let canceled = 0;
  const stream = synthesize({ voice: "custom-voice", text: "Hi" }, { auth, transport: "http", fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"chunk","data":"AQI="}\n')); }, cancel() { canceled++; } })) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  await stream.return?.(); expect(canceled).toBe(1);
});

test("HTTP and JSONL errors preserve native status and release response bodies", async () => {
  let canceled = 0;
  const options = { auth, transport: "http" as const, fetch: async () => new Response(new ReadableStream({ cancel() { canceled++; } }), { status: 429 }) };
  await expect(synthesize({ voice: "custom-voice", text: "Hi" }, options).next()).rejects.toEqual(new RespeecherError(429, "Respeecher returned HTTP 429"));
  expect(canceled).toBe(1);
  await expect(synthesize({ voice: "custom-voice", text: "Hi" }, { auth, transport: "http", fetch: async () => new Response('{"type":"error","error":"Ліміт","status_code":429}\n') }).next()).rejects.toEqual(new RespeecherError(429, "Ліміт"));
});

test.each(["!!!!", "AR==", "AQI", "A===" ])("malformed base64 %s fails rather than silently truncating", async data => {
  await expect(synthesize({ voice: "custom-voice", text: "Hi" }, { auth, transport: "http", fetch: async () => new Response(JSON.stringify({ type: "chunk", data }), { headers: { "content-type": "application/json" } }) }).next()).rejects.toEqual(new TypeError("Invalid Respeecher audio response"));
});

test.each([
  [{ type: "chunk", data: "AQI=" }, "Respeecher omitted the native context ID"],
  [{ type: "chunk", context_id: "unknown", data: "AQI=" }, "Respeecher returned an unknown context ID"],
] as const)("socket protocol error %# closes the socket and producer", async (packet, message) => {
  let returned = 0;
  const socket = new Socket((_message, socket) => socket.message(packet));
  const text = { [Symbol.asyncIterator]() { return { async next() { return { done: false as const, value: "Hi" }; }, async return() { returned++; return { done: true as const, value: undefined }; } }; } };
  await expect(synthesize({ voice: "custom-voice", text }, { auth, webSocket: socket }).next()).rejects.toEqual(new TypeError(message));
  expect(socket.closed).toBe(1); expect(returned).toBe(1);
});

test("abort releases blocked input without awaiting an uncooperative return", async () => {
  const started = Promise.withResolvers<void>(); let returned = 0;
  const socket = new Socket(); const controller = new AbortController();
  const text = { [Symbol.asyncIterator]() { return { next() { started.resolve(); return new Promise<IteratorResult<TtsInput>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<TtsInput>>(() => {}); } }; } };
  const result = synthesize({ voice: "custom-voice", text }, { auth, webSocket: socket, signal: controller.signal }).next();
  await started.promise; const reason = new Error("stop"); controller.abort(reason);
  await expect(result).rejects.toBe(reason); expect(returned).toBe(1); expect(socket.closed).toBe(1);
});

test("producer failure interrupts outstanding contexts and releases the socket", async () => {
  const failure = new Error("input failed");
  const socket = new Socket();
  const text = (async function* () { yield "Hello"; throw failure; })();
  await expect(synthesize({ voice: "custom-voice", text }, { auth, webSocket: socket }).next()).rejects.toBe(failure);
  expect(socket.closed).toBe(1);
});

test("consumer early return closes both socket and unfinished input", async () => {
  let returned = 0;
  const socket = new Socket((message, socket) => audio(socket, message.context_id));
  const text = { [Symbol.asyncIterator]() { return { async next() { return { done: false as const, value: "Hi" }; }, async return() { returned++; return { done: true as const, value: undefined }; } }; } };
  const stream = synthesize({ voice: "custom-voice", text }, { auth, webSocket: socket });
  await stream.next(); await stream.return?.();
  expect(socket.closed).toBe(1); expect(returned).toBe(1);
});

test("deadline aborts uncooperative fetch and cancels its late response", async () => {
  const response = Promise.withResolvers<Response>(); let canceled = 0;
  await expect(synthesize({ voice: "custom-voice", text: "Hi" }, { auth, transport: "http", timeoutMs: 5, fetch: () => response.promise }).next()).rejects.toEqual(new DOMException("Respeecher synthesis deadline expired", "TimeoutError"));
  response.resolve(new Response(new ReadableStream({ cancel() { canceled++; } })));
  await Promise.resolve(); expect(canceled).toBe(1);
});

test("close before native done is failure, not successful EOF", async () => {
  const socket = new Socket((_message, socket) => socket.emit("close"));
  await expect(synthesize({ voice: "custom-voice", text: "Hi" }, { auth, webSocket: socket }).next()).rejects.toEqual(new TypeError("Respeecher WebSocket closed before synthesis completed"));
});

test("native done cannot complete open text or claim success without audio", async () => {
  const early = new Socket((message, socket) => done(socket, message.context_id));
  const text = (async function* () { yield "Hi"; await new Promise(() => {}); })();
  await expect(synthesize({ voice: "custom-voice", text }, { auth, webSocket: early }).next()).rejects.toEqual(new TypeError("Respeecher completed a context before its text ended"));
  const silent = new Socket((message, socket) => { if (message.continue === false) done(socket, message.context_id); });
  await expect(synthesize({ voice: "custom-voice", text: "Hi" }, { auth, webSocket: silent }).next()).rejects.toEqual(new TypeError("Respeecher completed a context without audio"));
  expect(early.closed).toBe(1); expect(silent.closed).toBe(1);
});

test("option-level transport conflicts and pre-abort fail before socket/input acquisition", async () => {
  let acquired = false;
  const text = { [Symbol.asyncIterator](): AsyncIterator<string> { acquired = true; throw new Error("unexpected input"); } };
  await expect(synthesize({ voice: "custom-voice", text }, { auth, transport: "http" }).next()).rejects.toEqual(new TypeError("Respeecher incremental text requires WebSocket"));
  await expect(synthesize({ voice: "custom-voice", text: "Hi", output: { format: "wav" } }, { auth, transport: "websocket" }).next()).rejects.toEqual(new TypeError("Respeecher WAV output requires HTTP"));
  const reason = new Error("already stopped");
  await expect(synthesize({ voice: "custom-voice", text }, { auth, signal: AbortSignal.abort(reason) }).next()).rejects.toBe(reason);
  expect(acquired).toBe(false);
});

test("abort while a clear event is yielded neither advances input nor emits done", async () => {
  let reads = 0; let returned = 0;
  const socket = new Socket(); const controller = new AbortController();
  const text = { [Symbol.asyncIterator]() { return { async next() { reads++; return { done: false as const, value: { command: "clear" as const } }; }, async return() { returned++; return { done: true as const, value: undefined }; } }; } };
  const stream = synthesize({ voice: "custom", text }, { auth, webSocket: socket, signal: controller.signal });
  expect(await stream.next()).toEqual({ done: false, value: { event: "clear" } });
  const reason = new Error("stop during yield"); controller.abort(reason);
  await expect(stream.next()).rejects.toBe(reason);
  expect(reads).toBe(1); expect(returned).toBe(1); expect(socket.closed).toBe(1);
});

test("abort after the last JSONL audio chunk cannot emit successful done", async () => {
  const controller = new AbortController();
  const stream = synthesize({ voice: "custom", text: "Hi" }, { auth, transport: "http", signal: controller.signal, fetch: async () => new Response('{"type":"chunk","data":"AQI="}') });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  const reason = new Error("stop after audio"); controller.abort(reason);
  await expect(stream.next()).rejects.toBe(reason);
});
