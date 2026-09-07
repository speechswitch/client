import { expect, expectTypeOf, test } from "bun:test";
import { synthesize, GradiumError, type TtsRequest, type SynthesisItem } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { SynthesisEnvelope, Timestamp } from "../../timestamps.ts";
import type { WebSocketLike } from "../../websocket.ts";
import shared from "../../../sdks/fixtures/gradium.json";

const common = { voice: "existing-custom", output: { format: "pcm" } } as const;
const auth = { gradium: { apiKey: "private-key" } };
const settings = { model_name: "default", voice_id: "existing-custom", output_format: "pcm_48000", json_config: { temp: 0.7, cfg_coef: 2, padding_bonus: 0 } };
async function* input(...values: (string | { readonly command: "flush" })[]) { yield* values; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = false;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  onSend: (value: Record<string, any>) => void = message => {
    if (message.type === "setup") this.receive({ type: "ready", request_id: "req" });
    if (message.type === "text") this.receive({ type: "audio", audio: "AQI=" });
    if (message.type === "end_of_stream") this.receive({ type: "end_of_stream" });
  };
  send(data: unknown) { expect(typeof data).toBe("string"); const value = JSON.parse(data as string); this.sent.push(value); this.onSend(value); }
  close() { this.closed = true; this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: any) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
}

test("shared foreign fixtures preserve complete HTTP and socket settings", async () => {
  for (const fixture of shared.http) {
    const request = fixture.request as TtsRequest;
    await Array.fromAsync(synthesize(request, { auth, fetch: async (_url, init) => {
      expect(JSON.parse(init!.body as string)).toEqual({ ...fixture.settings, json_config: JSON.stringify(fixture.settings.json_config), text: "Hello", only_audio: true });
      return new Response(Uint8Array.of(0, 255));
    } }));
    const socket = new Socket();
    await Array.fromAsync(synthesize(request, { webSocket: socket }));
    expect(socket.sent[0]).toEqual({ type: "setup", ...fixture.settings, close_ws_on_eos: true, retry_for_s: 0 });
  }
  const socket = new Socket();
  await Array.fromAsync(synthesize({ ...common, text: input(...shared.text.input as (string | { command: "flush" })[]) }, { webSocket: socket }));
  expect(socket.sent.slice(1)).toEqual(shared.text.messages);
});

test("shared timeline fixtures preserve independent events", async () => {
  const expected = shared.timeline.map(({ item }) => ({ ...item, ...(item.audio === undefined ? {} : { audio: Uint8Array.from(item.audio.$bytes) }) }));
  const bytes = shared.timeline.map(({ packet }) => JSON.stringify(packet)).join("\n");
  const actual: unknown[] = await Array.fromAsync(synthesize({ ...common, text: "Hello", timestampGranularity: "segment" }, { auth, fetch: async () => new Response(bytes) }));
  expect(actual).toEqual(expected);
});

test("HTTP streams raw bytes before EOF, preserves proxy paths, and sends all resolved settings", async () => {
  let finish!: () => void;
  const stream = synthesize({ ...common, text: "Hello", model: "gradium-tts-beta", temperature: 0, voiceGuidance: 10, pacingBias: -5, textNormalization: false }, {
    auth, baseUrl: "https://proxy.invalid/gradium/api/?tenant=one", fetch: async (url, init) => {
      expect(String(url)).toBe("https://proxy.invalid/gradium/api/post/speech/tts?tenant=one");
      expect(init?.method).toBe("POST"); expect(init?.headers).toEqual({ "x-api-key": "private-key", "content-type": "application/json" });
      expect(JSON.parse(init?.body as string)).toEqual({ ...settings, model_name: "gradium-tts-beta", text: "Hello", only_audio: true,
        json_config: '{"temp":0,"cfg_coef":10,"padding_bonus":-5,"rewrite_rules":"none"}' });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); finish = () => { controller.enqueue(Uint8Array.of(2)); controller.close(); }; } }));
    },
  });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  finish(); expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(2) });
  expect(await stream.next()).toEqual({ done: true, value: undefined });
});

test.each([
  { output: { format: "wav", sampleRateHz: 48000 }, wire: "wav" },
  { output: { format: "ogg_opus" }, wire: "opus" },
  { output: { format: "mulaw", sampleRateHz: 8000 }, wire: "ulaw_8000" },
  { output: { format: "alaw", sampleRateHz: 8000 }, wire: "alaw_8000" },
  ...([8000, 16000, 22050, 24000, 44100, 48000] as const).map(sampleRateHz => ({ output: { format: "pcm" as const, sampleRateHz }, wire: `pcm_${sampleRateHz}` })),
] as const)("maps $wire consistently in HTTP and WebSocket", async ({ output, wire }) => {
  await Array.fromAsync(synthesize({ ...common, text: "Hello", output }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({ ...settings, output_format: wire, json_config: JSON.stringify(settings.json_config), text: "Hello", only_audio: true });
    return new Response(Uint8Array.of(1));
  } }));
  const socket = new Socket();
  await Array.fromAsync(synthesize({ ...common, output, text: input("Hello") }, { webSocket: socket }));
  expect(socket.sent[0]).toEqual({ type: "setup", ...settings, output_format: wire, close_ws_on_eos: true, retry_for_s: 0 });
});

test.each([
  { normalization: "auto", wire: undefined },
  { normalization: false, wire: "none" },
  { normalization: { locale: "fr-ch" }, wire: "fr-ch" },
  { normalization: { rules: ["CurrencyFrCh", "UrlFr", "AlNum"] }, wire: "CurrencyFrCh,UrlFr,AlNum" },
] as const)("normalization %j preserves native rule ordering", async ({ normalization, wire }) => {
  const socket = new Socket();
  await Array.fromAsync(synthesize({ ...common, text: "Hello", lexicon: "pronunciation-id", textNormalization: normalization }, { webSocket: socket, setupRetryMs: 250 }));
  expect(socket.sent[0]).toEqual({ type: "setup", ...settings, pronunciation_id: "pronunciation-id", close_ws_on_eos: true, retry_for_s: 0.25,
    json_config: { ...settings.json_config, ...(wire === undefined ? {} : { rewrite_rules: wire }) } });
});

test("token chunks preserve complete words, attached punctuation and markup; flush has no invented acknowledgement", async () => {
  const socket = new Socket();
  const result = await Array.fromAsync(synthesize({ ...common, text: input("Hel", "lo", ",", " wor", "ld", "! ", "<break ti", 'me="1.5s" /> ', "Do", "ne", { command: "flush" }, "Bye") }, { webSocket: socket }));
  expect(socket.sent.slice(1)).toEqual([
    { type: "text", text: "Hello," }, { type: "text", text: "world!" }, { type: "text", text: '<break time="1.5s" />' },
    { type: "text", text: "Done <flush>" }, { type: "text", text: "Bye" }, { type: "end_of_stream" },
  ]);
  expect(result).toEqual(Array.from({ length: 5 }, () => Uint8Array.of(1, 2))); expect(socket.closed).toBe(true);
});

test("audio is emitted while the input iterator is still producing text", async () => {
  const socket = new Socket(); const resume = deferred<void>();
  const text = (async function* () { yield "Hello "; await resume.promise; yield "world!"; })();
  const stream = synthesize({ ...common, text }, { webSocket: socket });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  expect(socket.sent.map(message => message.type)).toEqual(["setup", "text"]);
  resume.resolve(); expect(await Array.fromAsync(stream)).toEqual([Uint8Array.of(1, 2)]);
});

test("streamed input does not wait for ready, but server output must follow it", async () => {
  const socket = new Socket();
  socket.onSend = message => {
    if (message.type === "text") { socket.receive({ type: "ready", request_id: "req" }); socket.receive({ type: "audio", audio: "AQI=" }); }
    if (message.type === "end_of_stream") socket.receive({ type: "end_of_stream" });
  };
  expect(await Array.fromAsync(synthesize({ ...common, text: input("Hello ") }, { webSocket: socket }))).toEqual([Uint8Array.of(1, 2)]);
});

const timelinePackets = [
  { type: "text", text: "world", start_s: 0.2, stop_s: 0.4, stream_id: 0 },
  { type: "audio", audio: "AQI=", start_s: 0, stop_s: 0.08, stream_id: 0 },
  { type: "text", text: "Hello", start_s: 0, stop_s: 0.2, stream_id: 0 },
  { type: "audio", audio: "AwQ=" },
];
const timeline = [
  { correlation: "timeline", correlationId: "0", timestamps: [{ kind: "segment", value: "world", startTimeMs: 200, endTimeMs: 400 }] },
  { correlation: "timeline", correlationId: "0", audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 0, endTimeMs: 80 }, timestamps: [] },
  { correlation: "timeline", correlationId: "0", timestamps: [{ kind: "segment", value: "Hello", startTimeMs: 0, endTimeMs: 200 }] },
  { correlation: "timeline", audio: Uint8Array.of(3, 4), timestamps: [] },
] satisfies SynthesisEnvelope<Timestamp<"segment">>[];
test("HTTP NDJSON preserves independent text/audio timelines, including a final unterminated line and optional EOS", async () => {
  for (const eos of [false, true]) {
    const packets = [...timelinePackets, ...(eos ? [{ type: "end_of_stream" }] : [])];
    const text = packets.map(packet => JSON.stringify(packet)).join("\n");
    expect(await Array.fromAsync(synthesize({ ...common, text: "Hello world", timestampGranularity: "segment" }, { auth, fetch: async (_url, init) => {
      expect(JSON.parse(init?.body as string).only_audio).toBe(false);
      return new Response(new ReadableStream({ start(controller) { for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
    } }))).toEqual(timeline);
  }
});

test("WebSocket timestamps are not falsely associated with the nearest audio packet", async () => {
  const socket = new Socket();
  socket.onSend = message => {
    if (message.type === "setup") socket.receive({ type: "ready", request_id: "req" });
    if (message.type === "end_of_stream") { for (const packet of timelinePackets) socket.receive(packet); socket.receive({ type: "end_of_stream" }); }
  };
  expect(await Array.fromAsync(synthesize({ ...common, text: input("Hello world"), timestampGranularity: "segment" }, { webSocket: socket }))).toEqual(timeline);
});

test.each([
  { body: "error from server 1008: API key is revoked or expired", message: "API key is revoked or expired", code: 1008 },
  { body: "unsupported content type", message: "unsupported content type", code: null },
])("HTTP failure preserves status, native code and message: $code", async ({ body, message, code }) => {
  await expect(synthesize({ ...common, text: "Hello" }, { auth, fetch: async () => new Response(body, { status: 500 }) }).next()).rejects.toEqual(new GradiumError(message, 500, code));
});

test("errors after HTTP 200 terminate timestamp streams", async () => {
  const result = synthesize({ ...common, text: "Hello", timestampGranularity: "segment" }, { auth, fetch: async () => new Response('{"type":"audio","audio":"AQI="}\n{"type":"error","message":"failed"}\n') });
  expect(await result.next()).toEqual({ done: false, value: { correlation: "timeline", audio: Uint8Array.of(1, 2), timestamps: [] } });
  await expect(result.next()).rejects.toEqual(new GradiumError("failed", null, null));
});

test.each([
  { packet: { type: "audio", audio: "AA==", start_s: 1, stop_s: 0 }, error: "Gradium returned an invalid time range" },
  { packet: { type: "audio", audio: "AA==", start_s: 0 }, error: "Gradium returned an invalid time range" },
  { packet: { type: "text", text: "hi", start_s: 0, stop_s: 1e308 }, error: "Gradium returned an invalid time range" },
  { packet: { type: "text", text: "hi" }, error: "Gradium returned an invalid time range" },
  { packet: { type: "text", text: "hi", start_s: 0, stop_s: 1, stream_id: -1 }, error: "Gradium returned an invalid stream ID" },
  { packet: { type: "audio", audio: "AA==", client_req_id: "other" }, error: "Gradium returned an unexpected multiplexed request ID" },
  { packet: { type: "unrecognized" }, error: "Gradium returned an invalid event" },
] as const)("rejects malformed packet %j", async ({ packet, error }) => {
  const socket = new Socket(); socket.onSend = () => socket.receive(packet);
  await expect(synthesize({ ...common, text: input("Hello") }, { webSocket: socket }).next()).rejects.toEqual(new TypeError(error));
  expect(socket.closed).toBe(true);
});

test("generated request checks cover real model names, provider limits, encodings and normalization invariants", async () => {
  let calls = 0;
  for (const invalid of [
    { model: "tts" }, { model: "tts-beta" }, { voice: "" }, { temperature: 1.51 }, { pacingBias: 5.01 }, { voiceGuidance: 0.99 }, { speed: 2 }, { voiceSimilarity: 0.5 },
    { output: { format: "wav", sampleRateHz: 24000 } }, { output: { format: "pcm", sampleRateHz: 22000 } },
    { output: { format: "pcm", sampleEncoding: "float_32" } }, { output: { format: "pcm", byteOrder: "big_endian" } },
    { output: { format: "ogg_opus", sampleRateHz: 48000 } }, { output: { format: "mp3" } },
    { textNormalization: { locale: "en", rules: ["NumberEn"] } }, { textNormalization: { rules: ["bogus"] } },
    { textNormalization: {} }, { textNormalization: { rules: [] } }, { timestampGranularity: "word" },
  ]) await expect(synthesize({ ...common, text: "Hello", ...invalid } as TtsRequest, { auth, fetch: async () => { calls++; return new Response(); } }).next()).rejects.toEqual(new TypeError("Invalid gradium TTS request"));
  expect(calls).toBe(0);
});

test("invalid async commands are checked when consumed and cannot become spoken text", async () => {
  for (const item of [undefined, { command: "clear" }, { command: "update", replacements: [] }]) {
    const socket = new Socket();
    const request = { ...common, text: (async function* () { yield item; })() } as unknown as TtsRequest;
    await expect(synthesize(request, { webSocket: socket }).next()).rejects.toEqual(new TypeError("Invalid gradium TTS input item"));
    expect(socket.sent.map(message => message.type)).toEqual(["setup"]); expect(socket.closed).toBe(true);
  }
});

test("abort does not await an uncooperative iterator's pending next or return", async () => {
  const socket = new Socket(); const acquired = deferred<void>(); let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next() { acquired.resolve(); return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const controller = new AbortController(); const failure = new Error("barge in");
  const pending = synthesize({ ...common, text }, { webSocket: socket, signal: controller.signal }).next();
  await acquired.promise; controller.abort(failure);
  await expect(pending).rejects.toBe(failure); expect([socket.closed, returned]).toEqual([true, 1]);
});

test("input acquisition/iteration failures and consumer return clean up sockets", async () => {
  const failure = new Error("producer failure");
  for (const text of [
    { [Symbol.asyncIterator](): AsyncIterator<string> { throw failure; } },
    { [Symbol.asyncIterator]() { return { next: async () => { throw failure; } }; } },
  ]) {
    const socket = new Socket();
    await expect(synthesize({ ...common, text }, { webSocket: socket }).next()).rejects.toBe(failure); expect(socket.closed).toBe(true);
  }
  const socket = new Socket(); let returned = false;
  const text = { [Symbol.asyncIterator]() { return { next: async () => ({ done: false as const, value: "Hello " }), return: async () => { returned = true; return { done: true as const, value: undefined }; } }; } };
  const result = synthesize({ ...common, text }, { webSocket: socket });
  await result.next(); await result.return?.(); expect([returned, socket.closed]).toEqual([true, true]);
});

test("whole-operation deadline covers a socket that never opens or becomes ready", async () => {
  for (const readyState of [0, 1]) {
    const socket = new Socket(); socket.readyState = readyState; socket.onSend = () => {};
    await expect(synthesize({ ...common, text: input("Hello") }, { webSocket: socket, timeoutMs: 10 }).next()).rejects.toEqual(new DOMException("Gradium synthesis deadline expired", "TimeoutError"));
    expect(socket.closed).toBe(true);
  }
});

test("inline flush tags are transmitted immediately even without a following token", async () => {
  const socket = new Socket(); const resume = deferred<void>();
  const text = (async function* () { yield "Hi<flu"; yield "sh>"; await resume.promise; })();
  const result = synthesize({ ...common, text }, { webSocket: socket });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  expect(socket.sent.slice(1)).toEqual([{ type: "text", text: "Hi<flush>" }]);
  resume.resolve(); expect(await result.next()).toEqual({ done: true, value: undefined });
});

test("deadlines cover injected HTTP connection and body stalls", async () => {
  await expect(synthesize({ ...common, text: "Hi" }, { auth, timeoutMs: 10, fetch: () => new Promise(() => {}) }).next()).rejects.toEqual(new DOMException("Gradium synthesis deadline expired", "TimeoutError"));
  for (const timestampGranularity of [undefined, "segment"] as const) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise(() => {}); } });
    await expect(synthesize({ ...common, text: "Hi", timestampGranularity }, { auth, timeoutMs: 10, fetch: async () => new Response(body) }).next()).rejects.toEqual(new DOMException("Gradium synthesis deadline expired", "TimeoutError"));
    expect(cancelled).toBe(true);
  }
});

test.each([
  { events: [{ type: "audio", audio: "AA==" }], error: "Gradium returned output before ready" },
  { events: [{ type: "ready", request_id: "a" }, { type: "ready", request_id: "b" }], error: "Gradium returned duplicate ready" },
  { events: [{ type: "ready", request_id: "a" }, { type: "end_of_stream" }], error: "Gradium completed before the input stream ended" },
] as const)("validates protocol state: $error", async ({ events, error }) => {
  const socket = new Socket(); socket.onSend = () => { for (const event of events) socket.receive(event); };
  const text = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<string>>(() => {}) }; } };
  await expect(synthesize({ ...common, text }, { webSocket: socket }).next()).rejects.toEqual(new TypeError(error));
  expect(socket.closed).toBe(true);
});

test("an always-ready producer cannot starve a terminal server error", async () => {
  const socket = new Socket(); let count = 0; let returned = false;
  socket.onSend = message => { if (message.type === "setup") socket.receive({ type: "ready", request_id: "req" }); if (message.type === "text") socket.receive({ type: "error", message: "stop", code: 1008 }); };
  const text = { [Symbol.asyncIterator]() { return { next: async () => { count++; return { done: false as const, value: "Hello " }; }, return: async () => { returned = true; return { done: true as const, value: undefined }; } }; } };
  await expect(synthesize({ ...common, text }, { webSocket: socket }).next()).rejects.toEqual(new GradiumError("stop", null, 1008));
  expect(count).toBeLessThanOrEqual(3); expect([returned, socket.closed]).toEqual([true, true]);
});

test("type inference preserves provider-specific request and output types", () => {
  expectTypeOf(dispatch("gradium", { ...common, text: "Hello" }, { auth })).toEqualTypeOf<AsyncIterableIterator<SynthesisItem>>();
  dispatch("gradium", { ...common, model: "gradium-tts-beta", text: input("Hi ", { command: "flush" }), temperature: 1.5, pacingBias: -5, voiceGuidance: 10 });
  // @ts-expect-error Gradium does not implement a clear wire command.
  dispatch("gradium", { ...common, text: (async function* () { yield { command: "clear" as const }; })() });
  // @ts-expect-error Normalization is one cohesive value, not simultaneous locale and rule selectors.
  dispatch("gradium", { ...common, text: "Hi", textNormalization: { locale: "en", rules: ["NumberEn"] } });
  // @ts-expect-error A pacing bias is not a speech speed multiplier.
  dispatch("gradium", { ...common, text: "Hi", speed: 2 });
  // @ts-expect-error Amazon does not inherit Gradium's flush command.
  dispatch("amazon", { model: "generative", voice: "Amy", output: { format: "pcm" }, text: input({ command: "flush" }) });
});
