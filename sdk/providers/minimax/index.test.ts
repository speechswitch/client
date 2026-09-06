import { expect, test } from "bun:test";
import { synthesize, MiniMaxError, type TtsRequest, type TtsInput } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { WebSocketLike } from "../../websocket.ts";

const auth = { minimax: { apiKey: "test-key" } };
const common = { voice: "existing-custom-voice", text: "Hello" };
async function* input(...items: TtsInput[]) { yield* items; }
function success() { return Response.json({ data: { status: 2, audio: "00ff80" }, trace_id: "http-trace" }); }
function sse(...packets: unknown[]) {
  const data = new TextEncoder().encode(packets.map(packet => `data: ${JSON.stringify(packet)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}
class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = false;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  sessionId = "";
  onSend: (message: Record<string, any>) => void = message => {
    if (message.event === "task_continue") this.receive({ data: { audio: "00ff" }, is_final: true, trace_id: "request-1" });
    if (message.event === "task_finish") this.receive({ event: "task_finished" });
    if (message.event === "task_cancel") this.receive({ event: "task_canceled" });
    if (message.event === "task_flush") this.receive({ event: "task_flushed", trace_id: "flush-1" });
  };
  send(data: unknown) {
    const message = JSON.parse(String(data)); this.sent.push(message);
    if (message.event === "task_start") { this.sessionId = message.session_id; this.receive({ event: "task_started" }); }
    this.onSend(message);
  }
  close() { this.closed = true; this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: any) => void) {
    const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set);
    if (type === "message") queueMicrotask(() => this.emit("message", { data: JSON.stringify({ event: "connected_success", connect_id: "connection" }) }));
  }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(packet: object) { this.emit("message", { data: JSON.stringify({ session_id: this.sessionId, connect_id: "connection", ...packet }) }); }
}

test("MiniMax dispatch resolves HTTP defaults, auth and custom base paths", async () => {
  const actual = await Array.fromAsync(dispatch("minimax", common, { auth, baseUrl: "https://proxy.invalid/root?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://proxy.invalid/root/v1/t2a_v2?tenant=one");
    expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({ model: "speech-2.8-hd", language_boost: "auto",
      voice_setting: { voice_id: common.voice, speed: 1, vol: 1, pitch: 0, latex_read: false, text_normalization: false },
      audio_setting: { format: "mp3", sample_rate: 32000, channel: 1, bitrate: 128000, force_cbr: false },
      text: "Hello", stream: true, output_format: "hex", stream_options: { exclude_aggregated_audio: true }, subtitle_enable: false });
    return success();
  } }));
  expect(actual).toEqual([Uint8Array.of(0, 255, 128), { event: "done", traceId: "http-trace" }]);
});
test.each([
  [{ format: "mp3", constantBitRate: true }, "mp3", 32000, true],
  [{ format: "pcm" }, "pcm", 32000, true], [{ format: "flac" }, "flac", 32000, true],
  [{ format: "wav" }, "wav", 32000, false], [{ format: "mulaw" }, "pcmu_raw", 8000, true],
  [{ format: "wav", sampleEncoding: "mulaw" }, "pcmu_wav", 8000, true], [{ format: "ogg_opus" }, "opus", 24000, true],
] as const)("MiniMax maps format %# without folding rates or codecs into format names", async (output, format, rate, streaming) => {
  await Array.fromAsync(synthesize({ ...common, output }, { auth, fetch: async (_, init) => {
    const body = JSON.parse(init?.body as string);
    expect(body.audio_setting).toEqual({ format, sample_rate: rate, channel: 1, ...(format === "mp3" ? { bitrate: 128000, force_cbr: true } : {}) });
    expect(body.stream).toBe(streaming); return success();
  } }));
});
test("MiniMax maps blended voices, transformations and pronunciation explicitly", async () => {
  await Array.fromAsync(synthesize({ text: "$$1+1$$", formulaReading: "latex", voiceBlend: [{ voice: "one", weight: 75 }, { voice: "two", weight: 100 }],
    voiceTransform: { brightness: -10, softness: 20, crispness: 0, effect: "telephone" }, output: { format: "flac", channelCount: 2 },
    replacements: [{ pattern: "你好", replacement: "ni3 hao3" }], pitchBias: -2, volumeScale: 0.1, textNormalization: true }, { auth, fetch: async (_, init) => {
      expect(JSON.parse(init?.body as string)).toEqual({ model: "speech-2.8-hd", language_boost: "Chinese",
        voice_setting: { voice_id: "", speed: 1, vol: 0.1, pitch: -2, latex_read: true, text_normalization: true },
        audio_setting: { format: "flac", sample_rate: 32000, channel: 2 }, timbre_weights: [{ voice_id: "one", weight: 75 }, { voice_id: "two", weight: 100 }],
        pronunciation_dict: { tone: ["你好/ni3 hao3"] }, voice_modify: { pitch: -10, intensity: 20, timbre: 0, sound_effects: "lofi_telephone" },
        text: "$$1+1$$", stream: false, output_format: "hex", subtitle_enable: false });
      return success();
    } }));
});
test("MiniMax streams fragmented SSE, handles an empty final audio frame, and downloads independent subtitles without credentials", async () => {
  let calls = 0;
  const actual = await Array.fromAsync(synthesize({ ...common, timestampGranularity: "word" }, { auth, fetch: async (url, init) => {
    if (calls++ === 0) {
      expect(JSON.parse(init?.body as string).subtitle_type).toBe("word");
      return sse({ data: { audio: "01", status: 1 }, base_resp: { status_code: 0, status_msg: "你好" } },
        { data: { audio: "", status: 2, subtitle_file: "https://files.invalid/subtitles.json" }, trace_id: "trace", extra_info: { usage_characters: 5 } });
    }
    expect(String(url)).toBe("https://files.invalid/subtitles.json"); expect(init?.headers).toBeUndefined();
    expect(init?.credentials).toBe("omit"); expect(init?.redirect).toBe("error");
    return Response.json([{ text: "Hello", time_begin: 0.5, time_end: 250.25 }]);
  } }));
  expect(actual).toEqual([{ correlation: "timeline", audio: Uint8Array.of(1), timestamps: [] },
    { correlation: "timeline", traceId: "trace", timestamps: [{ kind: "word", value: "Hello", startTimeMs: 0.5, endTimeMs: 250.25 }] },
    { event: "done", traceId: "trace", usage: { billedCharacters: 5 } }]);
  expect(calls).toBe(2);
});
test.each([
  [() => sse({ data: { status: 1, audio: "01" } }), "MiniMax HTTP stream ended before completion"],
  [() => Response.json({ data: { status: 1, audio: "01" } }), "MiniMax JSON synthesis did not report completion"],
  [() => Response.json({ data: { status: 2, audio: "" } }), "MiniMax returned no audio"],
] as const)("MiniMax rejects incomplete HTTP result %#", async (response, message) => {
  expect(await Array.fromAsync(synthesize(common, { auth, fetch: async () => response() })).catch(error => error)).toEqual(new TypeError(message));
});
test("MiniMax preserves native errors on both HTTP and WebSocket", async () => {
  const packet = { event: "task_failed", base_resp: { status_code: 2205, status_msg: "queue full" }, data: null };
  const http = await Array.fromAsync(synthesize(common, { auth, fetch: async () => Response.json(packet, { status: 429, headers: { "Retry-After": "10" } }) })).catch(error => error);
  expect(http).toEqual(new MiniMaxError("queue full", 2205, 429, "10"));
  expect([http.code, http.statusCode, http.retryAfter]).toEqual([2205, 429, "10"]);
  const socket = new Socket(); socket.onSend = message => { if (message.event === "task_continue") socket.receive(packet); };
  const ws = await Array.fromAsync(synthesize({ voice: "voice", text: input("Hello") }, { webSocket: socket })).catch(error => error);
  expect(ws).toEqual(new MiniMaxError("queue full", 2205, null)); expect(ws.code).toBe(2205); expect(socket.closed).toBe(true);
});
test("MiniMax WS preserves native request boundaries without ending the session at is_final", async () => {
  const socket = new Socket();
  socket.onSend = message => {
    if (message.event === "task_continue") {
      socket.receive({ event: "sentence_start", trace_id: "native-request" });
      socket.receive({ data: { audio: "00ff" }, is_final: true, trace_id: "native-request" });
      socket.receive({ event: "sentence_end", trace_id: "native-request" });
    }
    if (message.event === "task_finish") socket.receive({ event: "task_finished" });
  };
  const actual = await Array.fromAsync(synthesize({ voice: "voice", text: input("Hello.", "Again."), splitTurns: false, languageTextNormalization: true }, { webSocket: socket }));
  const group = { correlation: "ordered", correlationId: "native-request", traceId: "native-request", inputGroupId: socket.sessionId, timestamps: [] } as const;
  const sentence = [{ ...group, sentenceBoundary: "start" }, { ...group, audio: Uint8Array.of(0, 255), requestComplete: true }, { ...group, sentenceBoundary: "end" }] as const;
  expect(actual).toEqual([...sentence, ...sentence, { event: "done" }]);
  expect(socket.sent[0]).toEqual({ model: "speech-2.8-hd", language_boost: "auto",
    voice_setting: { voice_id: "voice", speed: 1, vol: 1, pitch: 0, latex_read: false, english_normalization: true },
    audio_setting: { format: "mp3", sample_rate: 32000, channel: 1, bitrate: 128000 }, continuous_sound: true,
    event: "task_start", session_id: socket.sessionId, subtitle_enable: false });
  expect(socket.sent.slice(1)).toEqual([{ event: "task_continue", text: "Hello." }, { event: "task_continue", text: "Again." }, { event: "task_finish" }]);
  expect(socket.closed).toBe(true); expect([...socket.listeners.values()].map(set => set.size)).toEqual([0, 0, 0, 0]);
});
test("MiniMax clear can interrupt a pending flush, suppresses stale audio and resumes after acknowledgement", async () => {
  const socket = new Socket();
  socket.onSend = message => {
    if (message.event === "task_cancel") {
      socket.receive({ data: { audio: "dead" }, is_final: true });
      socket.receive({ event: "task_flushed" }); socket.receive({ event: "task_canceled" });
    }
    if (message.event === "task_continue" && message.text === "New.") socket.receive({ data: { audio: "01" }, trace_id: "new" });
    if (message.event === "task_finish") socket.receive({ event: "task_finished" });
  };
  const actual = await Array.fromAsync(synthesize({ voice: "voice", text: input("Old.", { command: "flush" }, { command: "clear" }, "New.") }, { webSocket: socket }));
  expect(socket.sent.slice(1)).toEqual([{ event: "task_continue", text: "Old." }, { event: "task_flush" }, { event: "task_cancel" }, { event: "task_continue", text: "New." }, { event: "task_finish" }]);
  expect(actual).toEqual([{ event: "clear" }, { correlation: "ordered", correlationId: "new", traceId: "new", inputGroupId: socket.sessionId, timestamps: [], audio: Uint8Array.of(1) }, { event: "done" }]);
});
test("MiniMax native flush acknowledgements do not fabricate per-input correlation", async () => {
  const socket = new Socket();
  const actual = await Array.fromAsync(synthesize({ voice: "voice", text: input({ command: "flush" }) }, { webSocket: socket }));
  expect(actual).toEqual([{ event: "flush", correlationId: "flush-1", inputGroupId: socket.sessionId }, { event: "done" }]);
});
test("MiniMax holds standalone whitespace so provider frame filtering cannot join words", async () => {
  const socket = new Socket();
  await Array.fromAsync(synthesize({ voice: "voice", text: input("Hello", " ", "\n", "world", " ") }, { webSocket: socket }));
  expect(socket.sent.slice(1)).toEqual([{ event: "task_continue", text: "Hello" }, { event: "task_continue", text: " \nworld" }, { event: "task_finish" }]);
});
test.each([
  [{ volumeScale: 0 }, "MiniMax volumeScale must be strictly positive"],
  [{ pitchBias: 0.5 }, "MiniMax pitch, voice transformations and blend weights must be integers"],
  [{ voice: undefined, voiceBlend: [] }, "MiniMax voiceBlend must contain one to four voices"],
  [{ voiceTransform: { softness: 0.5 } }, "MiniMax pitch, voice transformations and blend weights must be integers"],
] as const)("MiniMax rejects inexpressible constraint %# before opening a transport", async (fields, message) => {
  let called = false;
  const failure = await Array.fromAsync(synthesize({ ...common, ...fields } as TtsRequest, { auth, fetch: async () => { called = true; return success(); } })).catch(error => error);
  expect(failure).toEqual(new TypeError(message)); expect(called).toBe(false);
});
test("MiniMax transport overrides cannot bypass generated request restrictions", async () => {
  const socket = new Socket();
  expect(await Array.fromAsync(synthesize({ ...common, textNormalization: true }, { webSocket: socket })).catch(error => error)).toEqual(new TypeError("Invalid minimax TTS request"));
  expect(socket.sent).toEqual([]);
});
test("MiniMax returns a stalled producer without awaiting its return promise", async () => {
  const socket = new Socket(); let count = 0; let returns = 0;
  const text = { [Symbol.asyncIterator]() { return { next: () => count++ ? new Promise<IteratorResult<string>>(() => {}) : Promise.resolve({ done: false as const, value: "Hi" }), return: () => { returns++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const result = synthesize({ voice: "voice", text }, { webSocket: socket });
  expect((await result.next()).done).toBe(false); await result.return!(undefined);
  expect(returns).toBe(1); expect(socket.closed).toBe(true); expect(socket.sent.at(-1)).toEqual({ event: "task_cancel" });
});
test("MiniMax preserves producer failures", async () => {
  const failure = new Error("input failed"); const socket = new Socket();
  async function* broken() { throw failure; yield "unreachable"; }
  expect(await Array.fromAsync(synthesize({ voice: "voice", text: broken() }, { webSocket: socket })).catch(error => error)).toBe(failure);
  expect(socket.closed).toBe(true);
});

test("MiniMax producer failure interrupts a stalled cancel acknowledgement", async () => {
  const failure = new Error("producer failed during clear"); const socket = new Socket(); socket.onSend = () => {};
  async function* broken(): AsyncIterable<TtsInput> { yield { command: "clear" }; throw failure; }
  expect(await Array.fromAsync(synthesize({ voice: "voice", text: broken() }, { webSocket: socket, timeoutMs: 100 })).catch(error => error)).toBe(failure);
  expect(socket.closed).toBe(true);
});
test("MiniMax premature completion cannot hide behind a pending clear", async () => {
  const socket = new Socket(); socket.onSend = message => { if (message.event === "task_cancel") socket.receive({ event: "task_finished" }); };
  expect(await Array.fromAsync(synthesize({ voice: "voice", text: input({ command: "clear" }) }, { webSocket: socket, timeoutMs: 100 })).catch(error => error)).toEqual(new TypeError("MiniMax ended the session before acknowledging cancellation"));
  expect(socket.closed).toBe(true);
});
test("MiniMax abort interrupts a stalled producer and socket", async () => {
  let returns = 0; const socket = new Socket(); const controller = new AbortController(); const failure = new Error("stop");
  const text = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<string>>(() => {}), return: async () => { returns++; return { done: true as const, value: undefined }; } }; } };
  const pending = Array.fromAsync(synthesize({ voice: "voice", text }, { webSocket: socket, signal: controller.signal }));
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(failure);
  expect(await pending.catch(error => error)).toBe(failure); expect(returns).toBe(1); expect(socket.closed).toBe(true);
});
test("MiniMax deadlines interrupt fetch implementations that ignore abort", async () => {
  expect(await Array.fromAsync(synthesize(common, { auth, timeoutMs: 5, fetch: () => new Promise(() => {}) })).catch(error => error)).toEqual(new DOMException("MiniMax synthesis deadline expired", "TimeoutError"));
});
test("MiniMax HTTP consumer return cancels a still-open SSE body", async () => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"data":{"audio":"01","status":1}}\n\n')); }, cancel() { cancelled++; } });
  const result = synthesize(common, { auth, fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }) });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1) }); await result.return!(undefined);
  expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});

test("MiniMax HTTP gateway errors preserve status without exposing arbitrary HTML", async () => {
  const failure = await Array.fromAsync(synthesize(common, { auth, fetch: async () => new Response("<html>Unavailable</html>", { status: 503, headers: { "Retry-After": "10" } }) })).catch(error => error);
  expect(failure).toEqual(new MiniMaxError("MiniMax HTTP 503", null, 503, "10"));
  expect([failure.code, failure.statusCode, failure.retryAfter]).toEqual([null, 503, "10"]);
});
test("MiniMax abort interrupts a pending response read", async () => {
  let cancelled = 0; const controller = new AbortController(); const failure = new Error("stop reading");
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const pending = Array.fromAsync(synthesize(common, { auth, signal: controller.signal, fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }) }));
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(failure);
  expect(await pending.catch(error => error)).toBe(failure); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
test.each([
  ["wrong-session", "MiniMax returned an unexpected session ID"],
  ["wrong-connection", "MiniMax returned an unexpected connection ID"],
  ["early-close", "MiniMax WebSocket closed before task_finished"],
  ["unsolicited-cancel", "MiniMax returned an unsolicited cancel acknowledgement"],
] as const)("MiniMax rejects %s instead of claiming success", async (kind, message) => {
  const socket = new Socket();
  socket.onSend = packet => {
    if (packet.event !== "task_continue") return;
    if (kind === "early-close") socket.close();
    else if (kind === "wrong-session") socket.receive({ event: "sentence_start", session_id: "wrong" });
    else if (kind === "wrong-connection") socket.receive({ event: "sentence_start", connect_id: "wrong" });
    else socket.receive({ event: "task_canceled" });
  };
  expect(await Array.fromAsync(synthesize({ voice: "voice", text: input("Hi") }, { webSocket: socket })).catch(error => error)).toEqual(new TypeError(message));
  expect(socket.closed).toBe(true);
});
test.each([
  [["x".repeat(10000)], "MiniMax text pieces must contain fewer than 10000 UTF-16 code units"],
  [[" ".repeat(9999), "x"], "MiniMax pending whitespace exceeds a native message"],
] as const)("MiniMax rejects overlong native input %# without silently dropping whitespace", async (items, message) => {
  const socket = new Socket();
  expect(await Array.fromAsync(synthesize({ voice: "voice", text: input(...items) }, { webSocket: socket })).catch(error => error)).toEqual(new TypeError(message));
  expect(socket.sent.slice(1)).toEqual([{ event: "task_cancel" }]);
});
test("MiniMax default environment names resolve only at the provider boundary", async () => {
  const names = ["SPEECHSWITCH_MINIMAX_API_KEY", "MINIMAX_API_KEY"] as const;
  const previous = names.map(name => process.env[name]);
  process.env.SPEECHSWITCH_MINIMAX_API_KEY = "scoped-key"; process.env.MINIMAX_API_KEY = "vendor-key";
  const headers: (string | null)[] = [];
  const fetch = async (_: unknown, init?: RequestInit) => { headers.push(new Headers(init?.headers).get("Authorization")); return success(); };
  try {
    await Array.fromAsync(synthesize(common, { auth, fetch }));
    await Array.fromAsync(synthesize(common, { fetch }));
    delete process.env.SPEECHSWITCH_MINIMAX_API_KEY;
    await Array.fromAsync(synthesize(common, { fetch }));
    delete process.env.MINIMAX_API_KEY;
    expect(await Array.fromAsync(synthesize(common, { fetch })).catch(error => error)).toEqual(new TypeError("Missing auth.minimax.apiKey configuration"));
    expect(headers).toEqual(["Bearer test-key", "Bearer scoped-key", "Bearer vendor-key"]);
  } finally { names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); }
});
