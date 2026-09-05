import { expect, test } from "bun:test";
import { synthesize, MicrosoftError, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import { decodeFrame, type Frame } from "./protocol.ts";
import type { WebSocketLike } from "../../websocket.ts";

const auth = { microsoft: { apiKey: "test-key", region: "eastus" } };
const pcm = { format: "pcm", sampleRateHz: 24000 } as const;
const common = { voice: "en-US-AvaNeural", text: "Hello" };
async function* input(...values: string[]) { yield* values; }
class Socket implements WebSocketLike {
  readyState = 1; binaryType = ""; closed = false;
  readonly sent: Frame[] = [];
  readonly listeners = new Map<string, Set<(event: any) => void>>();
  onSend: (message: Frame) => void = message => {
    if (message.path === "ssml" || message.path === "text.piece") {
      this.receive("response", message.requestId, { audio: { streamId: "stream-1" } }); this.audio(message.requestId);
    }
    if (message.path === "ssml" || message.path === "text.end") this.receive("turn.end", message.requestId);
  };
  send(data: unknown) { const message = decodeFrame(data); this.sent.push(message); this.onSend(message); }
  close() { this.closed = true; this.readyState = 3; this.emit("close", {}); }
  addEventListener(type: string, listener: (event: any) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  receive(path: string, requestId: string, body: object = {}) { this.emit("message", { data: `Path: ${path}\r\nX-RequestId: ${requestId}\r\n\r\n${JSON.stringify(body)}` }); }
  audio(requestId: string, streamId = "stream-1") {
    const headers = new TextEncoder().encode(`Path: audio\r\nX-RequestId: ${requestId}\r\nX-StreamId: ${streamId}\r\n`);
    const frame = new Uint8Array(headers.length + 4); new DataView(frame.buffer).setUint16(0, headers.length, false);
    frame.set(headers, 2); frame.set([0, 255], headers.length + 2); this.emit("message", { data: frame.buffer });
  }
}

test("Microsoft dispatch streams HTTP bytes before the response finishes and escapes SSML", async () => {
  let finish!: () => void;
  const result = dispatch("microsoft", { ...common, text: 'A & <B> "C"', speed: 1.5, pitchSemitones: -2, volumeScale: 0.75, emotion: 'calm"' }, {
    auth, baseUrl: "https://proxy.invalid/root?tenant=one", deploymentId: "custom/1", fetch: async (url, init) => {
      expect(String(url)).toBe("https://proxy.invalid/root/cognitiveservices/v1?tenant=one&deploymentId=custom%2F1");
      expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
      expect(init?.headers).toEqual({ "Ocp-Apim-Subscription-Key": "test-key", "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm", "User-Agent": "speechswitch" });
      expect(init?.body).toBe('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="en-US-AvaNeural"><mstts:express-as style="calm&quot;"><prosody rate="1.5" pitch="-2st" volume="75">A &amp; &lt;B&gt; &quot;C&quot;</prosody></mstts:express-as></voice></speak>');
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); finish = () => { controller.enqueue(Uint8Array.of(2)); controller.close(); }; } }));
    },
  });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1) }); finish();
  expect(await Array.fromAsync(result)).toEqual([Uint8Array.of(2)]);
});

test.each([
  [{ format: "mp3", sampleRateHz: 16000, bitRateBps: 128000 }, "audio-16khz-128kbitrate-mono-mp3"],
  [{ format: "mp3", sampleRateHz: 24000, bitRateBps: 160000 }, "audio-24khz-160kbitrate-mono-mp3"],
  [{ format: "mp3", sampleRateHz: 48000, bitRateBps: 192000 }, "audio-48khz-192kbitrate-mono-mp3"],
  [{ format: "pcm", sampleRateHz: 22050 }, "raw-22050hz-16bit-mono-pcm"],
  [{ format: "pcm", sampleRateHz: 44100 }, "raw-44100hz-16bit-mono-pcm"],
  [{ format: "wav", sampleRateHz: 16000 }, "riff-16khz-16bit-mono-pcm"],
  [{ format: "wav", sampleRateHz: 8000, sampleEncoding: "alaw" }, "riff-8khz-8bit-mono-alaw"],
  [{ format: "wav", sampleRateHz: 8000, sampleEncoding: "mulaw" }, "riff-8khz-8bit-mono-mulaw"],
  [{ format: "alaw", sampleRateHz: 8000 }, "raw-8khz-8bit-mono-alaw"],
  [{ format: "mulaw", sampleRateHz: 8000 }, "raw-8khz-8bit-mono-mulaw"],
  [{ format: "ogg_opus", sampleRateHz: 48000 }, "ogg-48khz-16bit-mono-opus"],
  [{ format: "opus", sampleRateHz: 16000, bitRateBps: 32000 }, "audio-16khz-16bit-32kbps-mono-opus"],
  [{ format: "opus", sampleRateHz: 24000, bitRateBps: 48000 }, "audio-24khz-16bit-48kbps-mono-opus"],
  [{ format: "webm_opus", sampleRateHz: 24000, bitRateBps: 24000 }, "webm-24khz-16bit-24kbps-mono-opus"],
  [{ format: "webm_opus", sampleRateHz: 16000 }, "webm-16khz-16bit-mono-opus"],
  [{ format: "truesilk", sampleRateHz: 24000 }, "raw-24khz-16bit-mono-truesilk"],
  [{ format: "amr_wb", sampleRateHz: 16000 }, "amr-wb-16000hz"],
  [{ format: "g722", sampleRateHz: 16000, bitRateBps: 64000 }, "g722-16khz-64kbps"],
] as const)("Microsoft maps normalized format %# to its exact wire token", async (output, expected) => {
  await Array.fromAsync(synthesize({ ...common, output }, { auth, fetch: async (_, init) => {
    expect(new Headers(init?.headers).get("X-Microsoft-OutputFormat")).toBe(expected); return new Response(new Uint8Array([1]));
  } }));
});

test("Microsoft Omni selects its model suffix and native sampling parameters", async () => {
  await Array.fromAsync(synthesize({ text: "Hi", voice: "en-US-Ava", model: "dragon-hd-omni", temperature: 0.8, topP: 0.8, topK: 22, voiceGuidance: 1.2 }, { auth, fetch: async (_, init) => {
    expect(init?.body).toBe('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="en-US-Ava:DragonHDOmniLatestNeural" parameters="temperature=0.8;top_p=0.8;top_k=22;cfg_scale=1.2">Hi</voice></speak>');
    return new Response(new Uint8Array([1]));
  } }));
});

test("Microsoft HD separates its required root locale from an explicit speaking language", async () => {
  await Array.fromAsync(synthesize({ text: "Hola", voice: "en-US-Ava", model: "dragon-hd", language: "es-MX" }, { auth, fetch: async (_, init) => {
    expect(init?.body).toBe('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="en-US-Ava:DragonHDLatestNeural" parameters="temperature=1"><lang xml:lang="es-MX">Hola</lang></voice></speak>');
    return new Response(new Uint8Array([1]));
  } }));
});

test("Microsoft keeps a complete custom-voice SSML document intact and uses bearer auth", async () => {
  const markup = '<speak version="1.0" xml:lang="en-US"><voice name="custom">Hello</voice></speak>';
  await Array.fromAsync(synthesize({ inputType: "ssml", text: markup }, { auth: { microsoft: { apiKey: "unused", accessToken: "short-token", region: "eastus" } }, fetch: async (url, init) => {
    expect(String(url)).toBe("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"); expect(init?.body).toBe(markup);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer short-token"); expect(new Headers(init?.headers).get("Ocp-Apim-Subscription-Key")).toBeNull();
    return new Response(new Uint8Array([1]));
  } }));
});

test("Microsoft v2 sends incremental text unchanged with native input settings", async () => {
  const socket = new Socket();
  const result = await Array.fromAsync(synthesize({ voice: "en-US-Ava", model: "dragon-hd", text: input("Hi <", "there>"), temperature: 0 }, { webSocket: socket }));
  const id = socket.sent[0]!.requestId;
  expect(socket.sent.map(message => message.path)).toEqual(["speech.config", "synthesis.context", "text.piece", "text.piece", "text.end"]);
  expect(JSON.parse(socket.sent[1]!.body as string)).toEqual({ synthesis: {
    audio: { outputFormat: "raw-24khz-16bit-mono-pcm", metadataOptions: { wordBoundaryEnabled: false, sentenceBoundaryEnabled: false, punctuationBoundaryEnabled: false, bookmarkEnabled: false, visemeEnabled: false, sessionEndEnabled: true } },
    language: { autoDetection: false }, input: { bidirectionalStreamingMode: true, voiceName: "en-US-Ava:DragonHDLatestNeural", language: "en-US", temperature: "0" },
  } });
  expect(socket.sent.slice(2).map(message => message.body)).toEqual(["Hi <", "there>", ""]);
  expect(result).toEqual([Uint8Array.of(0, 255), Uint8Array.of(0, 255), { event: "done", requestId: id }]);
  expect(socket.closed).toBe(true); expect([...socket.listeners.values()].map(value => value.size)).toEqual([0, 0, 0, 0]);
});

test("Microsoft timestamps retain a shared timeline without fabricated chunk/source offsets", async () => {
  const socket = new Socket();
  socket.onSend = message => {
    if (message.path !== "ssml") return;
    socket.receive("response", message.requestId, { audio: { streamId: "stream-1" } });
    socket.audio(message.requestId);
    socket.receive("audio.metadata", message.requestId, { Metadata: [{ Type: "WordBoundary", Data: { Offset: 10000, Duration: 30000, text: { Text: "Hello" } } }] });
    socket.audio(message.requestId);
    socket.receive("audio.metadata", message.requestId, { Metadata: [{ Type: "SessionEnd", Data: { Offset: 50000 } }] });
    socket.receive("turn.end", message.requestId);
  };
  const actual = await Array.fromAsync(synthesize({ ...common, timestampGranularity: "word" }, { webSocket: socket }));
  const id = socket.sent[0]!.requestId; const group = { correlation: "timeline", correlationId: id, streamId: "stream-1" } as const;
  expect(actual).toEqual([
    { ...group, audio: Uint8Array.of(0, 255), timestamps: [] },
    { ...group, timestamps: [{ kind: "word", value: "Hello", startTimeMs: 1, endTimeMs: 4 }] },
    { ...group, audio: Uint8Array.of(0, 255), timestamps: [] },
    { ...group, timestamps: [], durationMs: 5 }, { event: "done", requestId: id, durationMs: 5 },
  ]);
});

test("Microsoft cleans up a consumer return without waiting for a stalled producer", async () => {
  const socket = new Socket(); let count = 0; let returns = 0;
  const text = { [Symbol.asyncIterator]() { return { next: () => count++ ? new Promise<IteratorResult<string>>(() => {}) : Promise.resolve({ done: false as const, value: "Hi" }), return: () => { returns++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const result = synthesize({ voice: common.voice, text }, { webSocket: socket });
  expect(await result.next()).toEqual({ value: Uint8Array.of(0, 255), done: false });
  await result.return!(undefined);
  expect(returns).toBe(1); expect(socket.closed).toBe(true);
  expect(socket.sent.at(-1)?.path).toBe("synthesis.control"); expect(socket.sent.at(-1)?.body).toBe('{"action":"stop"}');
});

test("Microsoft abort interrupts stalled input and response waits", async () => {
  const socket = new Socket(); socket.onSend = () => {}; let returns = 0;
  const text = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<string>>(() => {}), return: async () => { returns++; return { done: true as const, value: undefined }; } }; } };
  const controller = new AbortController(); const failure = new Error("stop now");
  const result = synthesize({ voice: common.voice, text }, { webSocket: socket, signal: controller.signal });
  const pending = result.next(); await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(failure);
  expect(await pending.catch(error => error)).toBe(failure); expect(returns).toBe(1); expect(socket.closed).toBe(true);
});

test("Microsoft preserves producer failures and closes its socket", async () => {
  const failure = new Error("producer failed"); const socket = new Socket();
  async function* broken() { throw failure; yield "unreachable"; }
  expect(await Array.fromAsync(synthesize({ voice: common.voice, text: broken() }, { webSocket: socket })).catch(error => error)).toBe(failure);
  expect(socket.closed).toBe(true);
});

test.each([
  ["early-close", "Microsoft WebSocket closed before turn.end"],
  ["wrong-stream", "Microsoft returned audio for an unexpected stream"],
  ["wrong-request", "Microsoft returned an unexpected synthesis request ID"],
] as const)("Microsoft rejects %s instead of reporting successful synthesis", async (kind, expected) => {
  const socket = new Socket(); socket.onSend = message => {
    if (message.path !== "ssml") return;
    if (kind === "early-close") socket.close();
    else if (kind === "wrong-stream") socket.audio(message.requestId, "unknown");
    else socket.receive("turn.end", "wrong-id");
  };
  expect(await Array.fromAsync(synthesize(common, { webSocket: socket })).catch(error => error)).toEqual(new TypeError(expected));
  expect(socket.closed).toBe(true);
});

test("Microsoft HTTP failures preserve status and retry information", async () => {
  const failure = await Array.fromAsync(synthesize(common, { auth, fetch: async () => new Response("quota exceeded", { status: 429, headers: { "Retry-After": "10" } }) })).catch(error => error);
  expect(failure).toEqual(new MicrosoftError("Microsoft synthesis failed (429): quota exceeded", 429, "10"));
  expect(failure.statusCode).toBe(429); expect(failure.retryAfter).toBe("10");
});
test("Microsoft rejects successful HTML error pages", async () => {
  expect(await Array.fromAsync(synthesize(common, { auth, fetch: async () => new Response("login", { headers: { "Content-Type": "text/html" } }) })).catch(error => error)).toEqual(new TypeError("Microsoft returned a non-audio response"));
});
test("Microsoft deadlines interrupt a fetch that ignores AbortSignal", async () => {
  const failure = await Array.fromAsync(synthesize(common, { auth, timeoutMs: 5, fetch: () => new Promise(() => {}) })).catch(error => error);
  expect(failure).toEqual(new DOMException("Microsoft synthesis deadline expired", "TimeoutError"));
});
test("Microsoft validates external data before acquiring its transport", async () => {
  let called = false;
  const invalid = { ...common, model: "dragon-hd-omni", speed: 1.5 } as unknown as TtsRequest;
  const failure = await Array.fromAsync(synthesize(invalid, { auth, fetch: async () => { called = true; return new Response(); } })).catch(error => error);
  expect(failure).toEqual(new TypeError("Invalid microsoft TTS request")); expect(called).toBe(false);
});

test("Microsoft explicit credentials override environment credentials and environment region still resolves", async () => {
  const names = ["SPEECHSWITCH_MICROSOFT_API_KEY", "SPEECHSWITCH_MICROSOFT_ACCESS_TOKEN", "SPEECHSWITCH_MICROSOFT_REGION"] as const;
  const previous = names.map(name => process.env[name]);
  process.env.SPEECHSWITCH_MICROSOFT_API_KEY = "environment-key";
  process.env.SPEECHSWITCH_MICROSOFT_ACCESS_TOKEN = "environment-token";
  process.env.SPEECHSWITCH_MICROSOFT_REGION = "westeurope";
  try {
    await Array.fromAsync(synthesize(common, { auth: { microsoft: { apiKey: "explicit-key" } }, fetch: async (url, init) => {
      expect(String(url)).toBe("https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1");
      expect(new Headers(init?.headers).get("Ocp-Apim-Subscription-Key")).toBe("explicit-key");
      expect(new Headers(init?.headers).get("Authorization")).toBeNull();
      return new Response(new Uint8Array([1]));
    } }));
    await Array.fromAsync(synthesize(common, { fetch: async (_, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer environment-token"); return new Response(new Uint8Array([1]));
    } }));
  } finally { names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); }
});

test("Microsoft HTTP consumer return releases the response reader", async () => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled++; } });
  const result = synthesize(common, { auth, fetch: async () => new Response(body) });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1) }); await result.return!(undefined);
  expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});

test.each([
  [{ model: "dragon-hd", voice: "en-US-Ava", namedEntityPronunciationEnhancement: true }, "en-US-Ava:DragonHDLatestNeural", ' parameters="temperature=1;enhancePronunciation=true"'],
  [{ model: "dragon-hd-flash", voice: "en-US-Tiana" }, "en-US-Tiana:DragonHDFlashLatestNeural", ""],
  [{ model: "mai-voice-2", voice: "en-US-Harper" }, "en-US-Harper:MAI-Voice-2", ""],
  [{ model: "mai-voice-2-flash", voice: "en-US-Harper" }, "en-US-Harper:MAI-Voice-2-Flash", ""],
] as const)("Microsoft model %# emits the documented persona suffix", async (request, voice, parameters) => {
  await Array.fromAsync(synthesize({ ...request, text: "Hi" }, { auth, fetch: async (_, init) => {
    expect(init?.body).toBe(`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voice}"${parameters}>Hi</voice></speak>`);
    return new Response(new Uint8Array([1]));
  } }));
});
