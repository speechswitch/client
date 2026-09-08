import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { validateRequest } from "../../generated/validators/murf.ts";
import { synthesize, MurfError, type TtsInput } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { WebSocketLike } from "../../websocket.ts";

const auth = { murf: { apiKey: "test-key" } };
const common = { text: "Hello", voice: "saved-custom-voice" };
async function* input(...items: TtsInput[]) { yield* items; }
function generated() { return { audioFile: "https://files.invalid/audio", encodedAudio: "AP+A", audioLengthInSeconds: 1.25, remainingCharacterCount: 0, wordDurations: [{ word: "Hello", startMs: 0, endMs: 1200 }] }; }
class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = false;
  readonly sent: Record<string, any>[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  onSend = (message: Record<string, any>) => {
    if (message.text) this.receive({ context_id: message.context_id, audio: "AP+A" });
    if (message.end) this.receive({ context_id: message.context_id, final: true });
  };
  send(data: unknown) { const message = JSON.parse(String(data)); this.sent.push(message); this.onSend(message); }
  close() { this.closed = true; this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: any) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(packet: object) { this.emit("message", { data: JSON.stringify(packet) }); }
}
test("Murf streams native HTTP bytes before completion with resolved Falcon defaults", async () => {
  let finish!: () => void;
  const result = dispatch("murf", common, { auth, baseUrl: "https://proxy.invalid/root?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://proxy.invalid/root/v1/speech/stream?tenant=one");
    expect(init?.headers).toEqual({ "api-key": "test-key", "Content-Type": "application/json", Accept: "audio/*, application/octet-stream" });
    expect(JSON.parse(init?.body as string)).toEqual({ text: "Hello", voiceId: common.voice, model: "falcon-2", format: "PCM", sampleRate: 24000, channelType: "MONO", rate: 0, pitch: 0 });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(0, 255, 128)); finish = () => controller.close(); } }), { headers: { "Content-Type": "audio/pcm" } });
  } });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(0, 255, 128) }); finish();
  expect(await Array.fromAsync(result)).toEqual([{ event: "done" }]);
});
test.each([["pcm", "PCM"], ["wav", "WAV"], ["mp3", "MP3"], ["flac", "FLAC"], ["ogg", "OGG"], ["alaw", "ALAW"], ["mulaw", "ULAW"]] as const)("Murf maps %s without guessing codec or resampling", async (format, native) => {
  await Array.fromAsync(synthesize({ ...common, output: { format, sampleRateHz: 16000, channelCount: 2 }, language: "fr-FR", voiceStyle: "Conversation", speedBias: 50, pitchBias: -50 }, { auth, fetch: async (_, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({ text: "Hello", voiceId: common.voice, model: "falcon-2", format: native, sampleRate: 16000, channelType: "STEREO", locale: "fr-FR", style: "Conversation", rate: 50, pitch: -50 });
    return new Response(Uint8Array.of(1));
  } }));
});
test("Murf Gen2 downloads byte-native audio without forwarding API credentials and preserves timeline timestamps", async () => {
  let calls = 0;
  const actual = await Array.fromAsync(synthesize({ ...common, model: "gen2", timestampGranularity: "word", timestampText: "original", language: "en-US", targetDurationMs: 1250, deliveryVariance: 0 }, { auth, fetch: async (url, init) => {
    if (calls++ === 0) {
      expect(String(url)).toBe("https://api.murf.ai/v1/speech/generate");
      expect(JSON.parse(init?.body as string)).toEqual({ text: "Hello", voiceId: common.voice, modelVersion: "GEN2", format: "PCM", sampleRate: 44100, channelType: "MONO", rate: 0, pitch: 0, variation: 0, locale: "en-US", wordDurationsAsOriginalText: true, audioDuration: 1.25, encodeAsBase64: false });
      return Response.json(generated());
    }
    expect(String(url)).toBe("https://files.invalid/audio"); expect(init?.headers).toBeUndefined(); expect(init?.credentials).toBe("omit"); expect(init?.redirect).toBe("error");
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(0)); controller.enqueue(Uint8Array.of(255, 128)); controller.close(); } }));
  } }));
  expect(calls).toBe(2);
  expect(actual).toEqual([{ correlation: "timeline", audio: Uint8Array.of(0), timestamps: [] }, { correlation: "timeline", audio: Uint8Array.of(255, 128), timestamps: [] },
    { correlation: "timeline", durationMs: 1250, timestamps: [{ kind: "word", value: "Hello", startTimeMs: 0, endTimeMs: 1200 }] }, { event: "done", remainingCharacters: 0 }]);
});
test("Murf zero-retention Gen2 returns inline audio and native usage without a CDN request", async () => {
  let calls = 0;
  const actual = await Array.fromAsync(synthesize({ ...common, model: "gen2", audioRetention: false, targetDurationMs: 0 }, { auth, fetch: async (_, init) => {
    calls++; expect(JSON.parse(init?.body as string).encodeAsBase64).toBe(true); expect(JSON.parse(init?.body as string).audioDuration).toBe(0);
    return Response.json({ ...generated(), audioFile: undefined, warning: "duration unchanged" });
  } }));
  expect(calls).toBe(1); expect(actual).toEqual([Uint8Array.of(0, 255, 128), { event: "done", remainingCharacters: 0, warning: "duration unchanged" }]);
});
test("Murf WebSocket updates preserve zero and empty style without inventing acknowledgements", async () => {
  const socket = new Socket();
  const actual = await Array.fromAsync(synthesize({ ...common, text: input("First", { command: "update", voice: "other", voiceStyle: "", language: "fr-FR", speedBias: 0, pitchBias: 0, textBufferThreshold: 160, maxBufferDelayMs: 0 }, " second") }, { auth, webSocket: socket }));
  const id = socket.sent[1]!.context_id;
  expect(socket.sent).toEqual([{ min_buffer_size: 40, max_buffer_delay_in_ms: 300 }, { context_id: id, voice_config: { voice_id: common.voice, rate: 0, pitch: 0 }, text: "First" },
    { context_id: id, voice_config: { voice_id: "other", style: "", locale: "fr-FR", rate: 0, pitch: 0 } }, { min_buffer_size: 160, max_buffer_delay_in_ms: 0 },
    { context_id: id, voice_config: { voice_id: "other", style: "", locale: "fr-FR", rate: 0, pitch: 0 }, text: " second" }, { context_id: id, text: "", end: true }]);
  expect(actual).toEqual([{ correlation: "ordered", correlationId: id, audio: Uint8Array.of(0, 255, 128), timestamps: [] }, { correlation: "ordered", correlationId: id, audio: Uint8Array.of(0, 255, 128), timestamps: [] }, { event: "done" }]);
  expect(socket.closed).toBe(true);
});
test("Murf clear rotates contexts and discards audio that finishes after cancellation", async () => {
  const socket = new Socket(); let cleared: string | undefined;
  socket.onSend = message => {
    if (message.clear) { cleared = message.context_id; socket.receive({ context_id: cleared, audio: "AQ==" }); socket.receive({ context_id: cleared, final: true }); }
    if (message.text === "new") socket.receive({ context_id: message.context_id, audio: "Ag==" });
    if (message.end) socket.receive({ context_id: message.context_id, final: true });
  };
  const actual = await Array.fromAsync(synthesize({ ...common, text: input("old", { command: "clear" }, "new") }, { auth, webSocket: socket }));
  const oldId = socket.sent[1]!.context_id; const newId = socket.sent[3]!.context_id;
  expect(cleared).toBe(oldId); expect(newId === oldId).toBe(false);
  expect(actual).toEqual([{ event: "clear" }, { correlation: "ordered", correlationId: newId, audio: Uint8Array.of(2), timestamps: [] }, { event: "done" }]);
});
test("Murf flush closes a context, receives its native final, then permits another context", async () => {
  const socket = new Socket();
  const actual = await Array.fromAsync(synthesize({ ...common, text: input("first", { command: "flush" }, "second") }, { auth, webSocket: socket }));
  const first = socket.sent[1]!.context_id; const second = socket.sent[3]!.context_id;
  expect(first === second).toBe(false);
  expect(actual).toEqual([{ correlation: "ordered", correlationId: first, audio: Uint8Array.of(0, 255, 128), timestamps: [] }, { event: "flush", correlationId: first, inputGroupId: first },
    { correlation: "ordered", correlationId: second, audio: Uint8Array.of(0, 255, 128), timestamps: [] }, { event: "done" }]);
});
test("Murf input failure escapes a stalled flush and closes the connection", async () => {
  const socket = new Socket(); socket.onSend = () => {}; const failure = new Error("input failed");
  const text = (async function* () { yield "Hello"; yield { command: "flush" } as const; throw failure; })();
  expect(await Array.fromAsync(synthesize({ ...common, text }, { auth, webSocket: socket })).catch(error => error)).toBe(failure);
  expect(socket.closed).toBe(true);
});
test.each([
  ["unknown", "Murf returned an unknown context ID"],
  ["premature", "Murf completed a context before its text ended"],
  ["silent", "Murf completed a context without audio"],
  ["closed", "Murf WebSocket closed before all contexts completed"],
] as const)("Murf rejects %s context completion", async (mode, message) => {
  const socket = new Socket();
  socket.onSend = packet => {
    if (packet.text && mode === "unknown") socket.receive({ context_id: "unrequested", audio: "AQ==" });
    if (packet.text && mode === "premature") socket.receive({ context_id: packet.context_id, final: true });
    if (packet.end && mode === "silent") socket.receive({ context_id: packet.context_id, final: true });
    if (packet.end && mode === "closed") socket.close();
  };
  expect(await Array.fromAsync(synthesize({ ...common, text: input("Hello") }, { auth, webSocket: socket })).catch(error => error)).toEqual(new TypeError(message));
  expect(socket.closed).toBe(true);
});
test("Murf consumer return releases HTTP readers", async () => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled++; } });
  const result = synthesize(common, { auth, fetch: async () => new Response(body) });
  await result.next(); await result.return!(undefined); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
test("Murf consumer return closes both streaming input and socket without waiting for source cleanup", async () => {
  const socket = new Socket(); let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next: async () => ({ done: false as const, value: "Hello" }), return: () => { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const result = synthesize({ ...common, text }, { auth, webSocket: socket });
  await result.next(); await result.return!(undefined); expect(returned).toBe(1); expect(socket.closed).toBe(true);
});
test.each(["audio/pcm", "application/json"])("Murf abort interrupts pending %s body reads", async contentType => {
  const controller = new AbortController(); const reason = new Error("stop"); let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const pending = Array.fromAsync(synthesize(contentType === "audio/pcm" ? common : { ...common, model: "gen2" }, { auth, signal: controller.signal, fetch: async () => new Response(body, { headers: { "Content-Type": contentType } }) }));
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(reason);
  expect(await pending.catch(error => error)).toBe(reason); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
test("Murf deadline handles an uncooperative fetch and cancels a late response", async () => {
  let resolve!: (response: Response) => void; let cancelled = 0;
  const pending = new Promise<Response>(done => { resolve = done; });
  expect(await Array.fromAsync(synthesize(common, { auth, timeoutMs: 5, fetch: () => pending })).catch(error => error)).toEqual(new DOMException("Murf synthesis deadline expired", "TimeoutError"));
  resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }))); await new Promise(resolve => setTimeout(resolve, 0)); expect(cancelled).toBe(1);
});
test("Murf errors preserve opaque HTTP details and retry information", async () => {
  expect(await Array.fromAsync(synthesize(common, { auth, fetch: async () => new Response("quota", { status: 402, headers: { "Retry-After": "5" } }) })).catch(error => error)).toEqual(new MurfError(402, "quota", "5"));
});
test.each(["http://files.invalid/audio", "https://user:password@files.invalid/audio"])("Murf rejects unsafe asset URL %# before fetching it", async audioFile => {
  let calls = 0;
  expect(await Array.fromAsync(synthesize({ ...common, model: "gen2" }, { auth, fetch: async () => { calls++; return Response.json({ ...generated(), audioFile }); } })).catch(error => error)).toEqual(new TypeError("Murf returned an unsafe audio file URL"));
  expect(calls).toBe(1);
});
test("Murf validates integer settings before network and does not coerce rate into a multiplier", async () => {
  let calls = 0;
  const request = { ...common, speedBias: 0.5 };
  let expected: unknown;
  try { validateRequest(request); } catch (error) { expected = error; }
  assert(expected instanceof TypeError);
  expect(await Array.fromAsync(synthesize(request, { auth, fetch: async () => { calls++; return new Response(); } })).catch(error => error)).toEqual(expected);
  expect(calls).toBe(0);
});
test.each([
  { speedBias: 0.5 }, { pitchBias: -0.5 }, { textBufferThreshold: 40.5 }, { maxBufferDelayMs: 0.5 },
])("Murf rejects fractional streamed update %# before sending it and closes input", async fields => {
  const socket = new Socket();
  let returned = false;
  const text = (async function* () {
    try { yield { command: "update" as const, ...fields }; }
    finally { returned = true; }
  })();
  expect(await Array.fromAsync(synthesize({ ...common, text }, { auth, webSocket: socket })).catch(error => error))
    .toEqual(new TypeError([
      "Invalid murf TTS input item:",
      "text item: expected string",
      `text item[${JSON.stringify(Object.keys(fields)[0])}]: expected safe integer`,
      'text item["command"]: expected "clear"',
      'text item["command"]: expected "flush"',
    ].join("\n")));
  expect(socket.sent).toEqual([{ min_buffer_size: 40, max_buffer_delay_in_ms: 300 }]);
  expect(socket.closed).toBe(true);
  expect(returned).toBe(true);
});
test("Murf browser bundle has no Node-only transport imports", async () => {
  const result = await Bun.build({ entrypoints: [new URL("./index.ts", import.meta.url).pathname], target: "browser" });
  expect(result.success).toBe(true); expect(result.logs).toEqual([]);
});
test("Murf auth precedence is explicit auth, namespaced environment, then native environment", async () => {
  const previous = [process.env.SPEECHSWITCH_MURF_API_KEY, process.env.MURF_API_KEY];
  const keys: string[] = [];
  const fetch = async (_: unknown, init?: RequestInit) => { keys.push(new Headers(init?.headers).get("api-key")!); return new Response(Uint8Array.of(1)); };
  try {
    process.env.SPEECHSWITCH_MURF_API_KEY = "namespaced"; process.env.MURF_API_KEY = "native";
    await Array.fromAsync(synthesize(common, { auth, fetch }));
    await Array.fromAsync(synthesize(common, { fetch }));
    delete process.env.SPEECHSWITCH_MURF_API_KEY; await Array.fromAsync(synthesize(common, { fetch }));
    delete process.env.MURF_API_KEY;
    expect(await Array.fromAsync(synthesize(common, { fetch })).catch(error => error)).toEqual(new TypeError("Missing auth.murf.apiKey configuration"));
    expect(keys).toEqual(["test-key", "namespaced", "native"]);
  } finally {
    if (previous[0] === undefined) delete process.env.SPEECHSWITCH_MURF_API_KEY; else process.env.SPEECHSWITCH_MURF_API_KEY = previous[0];
    if (previous[1] === undefined) delete process.env.MURF_API_KEY; else process.env.MURF_API_KEY = previous[1];
  }
});
