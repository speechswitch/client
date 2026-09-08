import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { validateRequest } from "../../generated/validators/kugelaudio.ts";
import { synthesize, KugelAudioError, type UpdateCommand } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { WebSocketLike } from "../../websocket.ts";
import { readFileSync } from "node:fs";

const common = { voice: "existing-custom-voice", output: { format: "pcm" } } as const;
const auth = { kugelaudio: { apiKey: "test-key" } };
const settings = { voice_id: common.voice, model_id: "kugel-3", cfg_scale: 2, max_new_tokens: 2048, sample_rate: 24000, normalize: true, speed: 1 };
const liveSettings = { ...settings, word_timestamps: false, speaker_prefix: true, flush_timeout_ms: 500, max_buffer_length: 10000 };
const audio = { audio: "AQI=", enc: "pcm_s16le", sr: 24000, samples: 1, idx: 0, chunk_id: 0 };
const word = { word: "Hi", start_ms: 0, end_ms: 10, char_start: 0, char_end: 2, score: 1 };
const marks = [{ kind: "word", value: "Hi", startTimeMs: 0, endTimeMs: 10, source: { start: 0, end: 2 }, confidence: 1 }] as const;
const billing = { audio_seconds: 1, characters: 2, cost_cents: 0.2, currency: "eur", model_id: "kugel-3" };
const usage = { audioSeconds: 1, characters: 2, costCents: 0.2, currency: "eur", model: "kugel-3" } as const;
async function* input(...values: (string | { readonly command: "clear" | "flush" } | UpdateCommand)[]) { yield* values; }
class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = false;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  onSend: (message: Record<string, any>) => void = message => {
    if (message.text) this.receive(audio);
    if (message.flush) { this.receive({ final: true }); this.receive({ session_closed: true }); }
    if (message.cancel) this.receive({ interrupted: true });
    if (message.update_settings) this.receive({ settings_updated: true, settings: message.update_settings });
  };
  send(data: unknown) { const message = JSON.parse(data as string); this.sent.push(message); this.onSend(message); }
  close() { this.closed = true; this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: any) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(value: object) { this.emit("message", { data: JSON.stringify(value) }); }
}

test("KugelAudio shared cross-language defaults, timestamps and usage", async () => {
  const fixture = JSON.parse(readFileSync(new URL("../../../sdks/fixtures/kugelaudio.json", import.meta.url), "utf8"));
  expect(await Array.fromAsync(synthesize(fixture.request, { auth, fetch: async (_, init) => {
    expect(JSON.parse(init!.body as string)).toEqual({ ...fixture.settings, text: "Hi", temperature: 0.4 });
    return new Response(Uint8Array.of(1, 2));
  } }))).toEqual([Uint8Array.of(1, 2)]);
  const socket = new Socket();
  socket.onSend = () => {
    for (const packet of [fixture.audio, fixture.audio, fixture.word, { final: true, usage: fixture.usage }]) socket.receive(packet);
  };
  const group = { correlation: "ordered", correlationId: "0:0", inputGroupId: "0", chunkId: 0 } as const;
  expect(await Array.fromAsync(synthesize({ ...fixture.request, timestampGranularity: "word" }, { webSocket: socket }))).toEqual([
    { ...group, audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 0, endTimeMs: 1 / 24 }, timestamps: [] },
    { ...group, audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 1 / 24, endTimeMs: 2 / 24 }, timestamps: [] },
    { ...group, timestamps: fixture.timestamps }, { event: "done", usage: fixture.billing },
  ]);
  expect(socket.sent).toEqual([{ ...fixture.settings, text: "Hi", temperature: 0.4, word_timestamps: true, speaker_prefix: true }]);
});

test("KugelAudio dispatch streams HTTP bytes immediately and resolves native static defaults", async () => {
  let finish!: () => void;
  const result = dispatch("kugelaudio", { ...common, text: "Hi" }, { auth, baseUrl: "https://proxy.invalid/root/?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://proxy.invalid/root/v1/tts/generate?tenant=one");
    expect(init?.method).toBe("POST"); expect(init?.headers).toEqual({ Authorization: "Bearer test-key", "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({ ...settings, temperature: 0.4, text: "Hi" });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); finish = () => { controller.enqueue(Uint8Array.of(2)); controller.close(); }; } }));
  } });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1) }); finish();
  expect(await Array.fromAsync(result)).toEqual([Uint8Array.of(2)]);
});

test.each([
  [{ format: "pcm", sampleRateHz: 44100 }, { sample_rate: 44100 }],
  [{ format: "pcm", sampleRateHz: 8000 }, { sample_rate: 8000 }],
  [{ format: "mulaw" }, { sample_rate: 8000, output_format: "ulaw_8000" }],
  [{ format: "alaw" }, { sample_rate: 8000, output_format: "alaw_8000" }],
] as const)("normalized output %j avoids contradictory codec/rate tokens", async (output, wire) => {
  await Array.fromAsync(synthesize({ ...common, text: "<spell>API</spell>", output, voice: 1071, model: "kugel-2-turbo", voiceGuidance: 1.2, temperature: 0, speed: 1.2, language: "de", textNormalization: false, maxAudioTokens: 2,
    pronunciationDictionarySelection: { scope: 10, ids: [7, 9] } }, { auth, fetch: async (_url, init) => {
      expect(JSON.parse(init?.body as string)).toEqual({ ...settings, ...wire, voice_id: 1071, model_id: "kugel-2-turbo", cfg_scale: 1.2, temperature: 0, speed: 1.2, language: "de", normalize: false, max_new_tokens: 2,
        text: "<spell>API</spell>", project_id: 10, dictionary_ids: [7, 9] }); return new Response(Uint8Array.of(1, 2));
    } }));
});

test.each([[undefined], [[]], [[7]]] as const)("dictionary selection preserves omission versus explicit IDs %j", async ids => {
  await Array.fromAsync(synthesize({ ...common, text: "Hi", pronunciationDictionarySelection: { scope: 10, ...(ids === undefined ? {} : { ids }) } }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({ ...settings, temperature: 0.4, text: "Hi", project_id: 10, ...(ids === undefined ? {} : { dictionary_ids: ids }) }); return new Response(Uint8Array.of(1));
  } }));
});

test.each([
  ["eu-test", undefined, undefined, "https://api.eu.kugelaudio.com/v1/tts/generate"],
  ["eu-test", "global", undefined, "https://api.kugelaudio.com/v1/tts/generate"],
  ["test", "eu", undefined, "https://api.eu.kugelaudio.com/v1/tts/generate"],
  ["eu-test", "eu", "https://proxy.invalid", "https://proxy.invalid/v1/tts/generate"],
] as const)("region resolution strips key prefix and respects explicit URL", async (apiKey, region, baseUrl, expected) => {
  await Array.fromAsync(synthesize({ ...common, text: "Hi" }, { auth: { kugelaudio: { apiKey } }, region, baseUrl, fetch: async (url, init) => {
    expect(String(url)).toBe(expected); expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test"); return new Response(Uint8Array.of(1));
  } }));
});

test("live turns flush once, do not resend config, and preserve unset live temperature", async () => {
  const socket = new Socket();
  expect(await Array.fromAsync(synthesize({ ...common, text: input("Hel", "lo", { command: "flush" }, "!") }, { webSocket: socket }))).toEqual([
    Uint8Array.of(1, 2), Uint8Array.of(1, 2), { event: "flush", correlationId: "0", inputGroupId: "0" }, Uint8Array.of(1, 2), { event: "flush", correlationId: "1", inputGroupId: "1" },
  ]);
  expect(socket.sent).toEqual([liveSettings, { text: "Hel" }, { text: "lo" }, { flush: true }, { text: "!" }, { flush: true }, { close_socket: true }]); expect(socket.closed).toBe(true);
});

test("new text waits for session_closed, not just final", async () => {
  const socket = new Socket(); let release!: () => void;
  socket.onSend = message => {
    if (message.text) socket.receive(audio);
    if (message.flush) { socket.receive({ final: true }); release = () => socket.receive({ session_closed: true }); }
  };
  const result = synthesize({ ...common, text: input("First", { command: "flush" }, "Next") }, { webSocket: socket });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
  const pending = result.next(); await new Promise(resolve => setTimeout(resolve, 5));
  expect(socket.sent).toEqual([liveSettings, { text: "First" }, { flush: true }]); release();
  expect(await pending).toEqual({ done: false, value: { event: "flush", correlationId: "0", inputGroupId: "0" } });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) }); await result.return!();
});

test("clear interrupts a draining turn, discards in-flight output, and waits for the real ack", async () => {
  const socket = new Socket(); let cancel!: () => void; let cancellation!: () => void; const cancelled = new Promise<void>(resolve => { cancellation = resolve; });
  socket.onSend = message => {
    if (message.cancel) { socket.receive(audio); socket.receive({ word_timestamps: [word], chunk_id: 0 }); socket.receive({ final: true }); socket.receive({ session_closed: true }); cancel = () => socket.receive({ interrupted: true }); cancellation(); }
  };
  const result = synthesize({ ...common, text: input("Old", { command: "flush" }, { command: "clear" }, "New"), timestampGranularity: "word" }, { webSocket: socket });
  const pending = result.next(); await cancelled;
  expect(socket.sent).toEqual([{ ...liveSettings, word_timestamps: true }, { text: "Old" }, { flush: true }, { cancel: true }]); cancel();
  expect(await pending).toEqual({ done: false, value: { event: "clear" } });
  socket.onSend = message => { if (message.text) socket.receive(audio); if (message.flush) { socket.receive({ final: true }); socket.receive({ session_closed: true }); } };
  expect(await Array.fromAsync(result)).toEqual([
    { correlation: "ordered", correlationId: "1:0", inputGroupId: "1", chunkId: 0, audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 0, endTimeMs: 1 / 24 }, timestamps: [] },
    { event: "flush", correlationId: "1", inputGroupId: "1" },
  ]);
});

test("fractional live token limits fail generated validation without sending an update", async () => {
  const socket = new Socket(); let returned = false;
  async function* text() {
    try { yield { command: "update", maxAudioTokens: 1.5 } as const; }
    finally { returned = true; }
  }
  await expect(synthesize({ ...common, text: text() }, { webSocket: socket }).next()).rejects.toEqual(new TypeError([
    "Invalid kugelaudio TTS input item:",
    "text item: expected string",
    'text item["maxAudioTokens"]: expected safe integer',
    'text item["command"]: expected "clear"',
    'text item["command"]: expected "flush"',
  ].join("\n")));
  expect(socket.sent).toEqual([liveSettings]);
  expect(socket.closed).toBe(true);
  expect(returned).toBe(true);
});

test("updates send only specified generation fields and finish only after acknowledgement", async () => {
  const socket = new Socket();
  expect(await Array.fromAsync(synthesize({ ...common, text: input({ command: "update", voiceGuidance: 1.5, temperature: 0, maxAudioTokens: 3, language: "de", textNormalization: false, speed: 1.1 }) }, { webSocket: socket }))).toEqual([
    { event: "updated", voiceGuidance: 1.5, temperature: 0, maxAudioTokens: 3, language: "de", textNormalization: false, speed: 1.1 },
  ]);
  expect(socket.sent).toEqual([liveSettings, { update_settings: { cfg_scale: 1.5, temperature: 0, max_new_tokens: 3, language: "de", normalize: false, speed: 1.1 } }, { close_socket: true }]);
});

test.each([[[]], [[""]], [[{ command: "flush" }]], [[{ command: "clear" }]]] as const)("empty input or idle control %j terminates without a fabricated turn", async values => {
  const socket = new Socket(); const result = await Array.fromAsync(synthesize({ ...common, text: input(...values) }, { webSocket: socket }));
  expect(result).toEqual(values[0] && typeof values[0] === "object" && values[0].command === "clear" ? [{ event: "clear" }] : []);
  expect(socket.sent.at(-1)).toEqual({ close_socket: true }); expect(socket.closed).toBe(true);
});

test("idle auto-ended turns keep reading input, warn, and reset timestamp group IDs", async () => {
  const socket = new Socket(); const warnings: string[] = [];
  let resume!: () => void; const resumed = new Promise<void>(resolve => { resume = resolve; });
  socket.onSend = message => {
    if (message.text) { socket.receive(audio); socket.receive({ word_timestamps: [word], chunk_id: 0 }); socket.receive({ warning: "Idle turn auto-ended" }); socket.receive({ final: true }); socket.receive({ session_closed: true, usage: billing }); }
  };
  const text = (async function* () { yield "Hi"; await resumed; yield "Again"; await resumed; })();
  const result = synthesize({ ...common, text, timestampGranularity: "word" }, { webSocket: socket, onWarning: value => warnings.push(value) });
  const expected = (turn: number) => [
    { correlation: "ordered", correlationId: `${turn}:0`, inputGroupId: String(turn), chunkId: 0, audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 0, endTimeMs: 1 / 24 }, timestamps: [] },
    { correlation: "ordered", correlationId: `${turn}:0`, inputGroupId: String(turn), chunkId: 0, timestamps: marks },
    { event: "flush", correlationId: String(turn), inputGroupId: String(turn), usage },
  ] as const;
  const first = []; for (let i = 0; i < 3; i++) first.push((await result.next()).value); expect(first).toEqual([...expected(0)]); resume();
  expect(await Array.fromAsync(result)).toEqual([...expected(1)]); expect(warnings).toEqual(["Idle turn auto-ended", "Idle turn auto-ended"]);
});

test("static socket timestamps keep native chunk association when alignments arrive out of order", async () => {
  const socket = new Socket(); socket.onSend = () => {
    socket.receive({ ...audio, chunk_id: 7 }); socket.receive({ ...audio, chunk_id: 8, idx: 1 }); socket.receive({ ...audio, chunk_id: 7, idx: 2 });
    socket.receive({ word_timestamps: [word], chunk_id: 8 }); socket.receive({ word_timestamps: [word], chunk_id: 7 }); socket.receive({ final: true, usage: billing });
  };
  expect(await Array.fromAsync(synthesize({ ...common, text: "Hi", timestampGranularity: "word", voiceBoost: false }, { webSocket: socket }))).toEqual([
    { correlation: "ordered", correlationId: "0:7", inputGroupId: "0", chunkId: 7, audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 0, endTimeMs: 1 / 24 }, timestamps: [] },
    { correlation: "ordered", correlationId: "0:8", inputGroupId: "0", chunkId: 8, audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 0, endTimeMs: 1 / 24 }, timestamps: [] },
    { correlation: "ordered", correlationId: "0:7", inputGroupId: "0", chunkId: 7, audio: Uint8Array.of(1, 2), audioTiming: { startTimeMs: 1 / 24, endTimeMs: 1 / 12 }, timestamps: [] },
    { correlation: "ordered", correlationId: "0:8", inputGroupId: "0", chunkId: 8, timestamps: marks },
    { correlation: "ordered", correlationId: "0:7", inputGroupId: "0", chunkId: 7, timestamps: marks }, { event: "done", usage },
  ]);
  expect(socket.sent).toEqual([{ ...settings, temperature: 0.4, text: "Hi", word_timestamps: true, speaker_prefix: false }]);
});

test.each([
  [{ ...audio, chunk_id: undefined }, "KugelAudio returned invalid chunk_id"],
  [{ ...audio, sr: 8000 }, "KugelAudio returned an unexpected audio format"],
  [{ ...audio, samples: 2 }, "KugelAudio audio size disagrees with its sample count"],
  [{ word_timestamps: [{ ...word, end_ms: -1 }], chunk_id: 0 }, "KugelAudio returned invalid end_ms"],
  [{ word_timestamps: [{ ...word, char_end: -1 }], chunk_id: 0 }, "KugelAudio returned invalid char_end"],
  [{ word_timestamps: [{ ...word, start_ms: 20 }], chunk_id: 0 }, "KugelAudio returned reversed alignment bounds"],
  [{ final: false }, "KugelAudio returned an invalid event flag"],
  [{ session_closed: true }, "KugelAudio ended a turn before final"],
  [{ interrupted: true }, "KugelAudio returned an unsolicited interruption"],
  [{ settings_updated: true, settings: {} }, "KugelAudio returned an unsolicited settings acknowledgement"],
  [{ alien: true }, "KugelAudio returned an invalid event"],
] as const)("rejects malformed response %j", async (packet, message) => {
  const socket = new Socket(); socket.onSend = () => socket.receive(packet);
  await expect(Array.fromAsync(synthesize({ ...common, text: "Hi", timestampGranularity: "word" }, { webSocket: socket }))).rejects.toEqual(new TypeError(message)); expect(socket.closed).toBe(true);
});

test("HTTP and socket errors retain status, category and HTTP retry timing", async () => {
  const packet = { error: "Busy", error_code: "RATE_LIMITED", code: 429 };
  const http = await synthesize({ ...common, text: "Hi" }, { auth, fetch: async () => Response.json(packet, { status: 429, headers: { "retry-after": "10" } }) }).next().catch(error => error);
  const socket = new Socket(); socket.onSend = () => socket.receive(packet);
  const ws = await synthesize({ ...common, text: input("Hi") }, { webSocket: socket }).next().catch(error => error);
  for (const [error, retryAfter] of [[http, "10"], [ws, null]]) { expect(error).toBeInstanceOf(KugelAudioError); expect({ message: error.message, statusCode: error.statusCode, code: error.code, retryAfter: error.retryAfter }).toEqual({ message: "Busy", statusCode: 429, code: "RATE_LIMITED", retryAfter }); }
});

test("missing billing cost stays null instead of becoming zero", async () => {
  const socket = new Socket(); socket.onSend = () => socket.receive({ final: true, usage: { ...billing, cost_cents: null, cost_unavailable: true } });
  expect(await Array.fromAsync(synthesize({ ...common, text: "Hi" }, { webSocket: socket }))).toEqual([{ event: "done", usage: { ...usage, costCents: null } }]);
});

test("abort and early return release stalled input without awaiting its return", async () => {
  for (const abort of [true, false]) {
    const socket = new Socket(); const controller = new AbortController(); let returned = 0; let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let first = true;
    const text = { [Symbol.asyncIterator]() { return { next() { started(); if (!abort && first) { first = false; return Promise.resolve({ done: false as const, value: "Hi" }); } return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
    const result = synthesize({ ...common, text }, { webSocket: socket, signal: controller.signal }); const pending = result.next(); await ready;
    if (abort) { controller.abort(new Error("stop")); await expect(pending).rejects.toEqual(new Error("stop")); }
    else { expect(await pending).toEqual({ done: false, value: Uint8Array.of(1, 2) }); await result.return!(); }
    expect(returned).toBe(1); expect(socket.closed).toBe(true);
  }
});

test("deadline covers a fetch ignoring abort and cancels its eventual response", async () => {
  let respond!: (response: Response) => void; let cancelled = false;
  const result = synthesize({ ...common, text: "Hi" }, { auth, timeoutMs: 5, fetch: () => new Promise(resolve => { respond = resolve; }) });
  await expect(result.next()).rejects.toEqual(new DOMException("KugelAudio synthesis deadline expired", "TimeoutError"));
  respond(new Response(new ReadableStream({ cancel() { cancelled = true; } }))); await Promise.resolve(); expect(cancelled).toBe(true);
});

test("deadline covers a blocked input and blocked HTTP body", async () => {
  const socket = new Socket();
  const text = { async *[Symbol.asyncIterator]() { await new Promise(() => {}); yield "Hi"; } };
  await expect(synthesize({ ...common, text }, { webSocket: socket, timeoutMs: 5 }).next()).rejects.toEqual(new DOMException("KugelAudio synthesis deadline expired", "TimeoutError")); expect(socket.closed).toBe(true);
  let cancelled = false;
  await expect(synthesize({ ...common, text: "Hi" }, { auth, timeoutMs: 5, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) }).next()).rejects.toEqual(new DOMException("KugelAudio synthesis deadline expired", "TimeoutError")); expect(cancelled).toBe(true);
});

test("deadline releases an incomplete error body even when its cancel promise stalls", async () => {
  let cancelled = false;
  await expect(synthesize({ ...common, text: "Hi" }, { auth, timeoutMs: 5, fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"error":')); }, cancel() { cancelled = true; return new Promise(() => {}); },
  }), { status: 429 }) }).next()).rejects.toEqual(new DOMException("KugelAudio synthesis deadline expired", "TimeoutError")); expect(cancelled).toBe(true);
});

test("generated integer and cardinality constraints fail before network access", async () => {
  const fetch = async () => { throw new Error("unexpected network"); };
  for (const fields of [
    { maxAudioTokens: 1.5 }, { pronunciationDictionarySelection: { scope: 1.5 } },
    { pronunciationDictionarySelection: { scope: 1, ids: [1.5] } },
    { pronunciationDictionarySelection: { scope: 1, ids: Array.from({ length: 51 }, (_, i) => i) } },
    { text: input("Hi"), textBufferThreshold: 1.5 }, { text: input("Hi"), textFlushDelayMs: 1.5 },
  ]) {
    const request = { ...common, text: "Hi", ...fields };
    let expected: unknown;
    try { validateRequest(request); } catch (error) { expected = error; }
    assert(expected instanceof TypeError);
    await expect(synthesize(request, { auth, fetch }).next()).rejects.toEqual(expected);
  }
});
