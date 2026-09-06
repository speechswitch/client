import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { synthesize, VocuError, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import { validateRequest } from "../../generated/validators/vocu.ts";

const auth = { vocu: { apiKey: "test-key" } };
const request = { voice: "market:existing", text: "Hello" } as const;
const wire = { voiceId: "market:existing", text: "Hello", promptId: "default", preset: "balance", language: "auto", vivid: false, speechRate: 1, seed: -1 };
const audio = () => new Response(Uint8Array.of(0, 255, 128), { headers: { "content-type": "audio/mpeg" } });
const data = (value: object) => Response.json({ status: 200, data: value });
const generated = { id: "job", status: "generated", metadata: { audio: "https://storage.vocu.ai/generate/result.mp3", srt: false } };

test("default uses authenticated POST byte streaming, preserving text outside URLs", async () => {
  const result = await Array.fromAsync(dispatch("vocu", request, { auth, baseUrl: "https://proxy.test/base", fetch: async (url, init) => {
    expect(String(url)).toBe("https://proxy.test/base/api/tts/simple-generate");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json" });
    expect([init?.redirect, init?.credentials]).toEqual(["error", "omit"]);
    expect(JSON.parse(String(init?.body))).toEqual({ ...wire, flash: false, srt: false, stream: true, direct_stream: true });
    return audio();
  } }));
  expect(result).toEqual([Uint8Array.of(0, 255, 128), { event: "done", completion: "transport" }]);
});

test("voice/style, reciprocal speed, language and independent controls map exactly", async () => {
  await Array.fromAsync(synthesize({ ...request, voiceStyle: "my-style", language: "en-US", speed: 2, randomSeed: 0, deliveryMode: "stable", emotionSource: "voice", vividExpression: false,
    emotionBlend: { anger: 5, sadness: 2, contextual: 0 }, longTextMode: false, audioProcessingProfile: "chain", latencyOptimization: "maximum" }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual({ ...wire, promptId: "my-style", language: "en-us", speechRate: 0.5, seed: 0, preset: "stable", break_clone: false,
      emo_switch: [5, 0, 0, 2, 0], infinite_mode: false, post_processing: "chain", flash: true, srt: false, stream: true, direct_stream: true });
    return audio();
  } }));
});

test("controllable markup is one native path and excludes SRT", async () => {
  await Array.fromAsync(synthesize({ ...request, text: "{{happy}}Bonjour", inputType: "markup", referenceEmphasis: "expressive", language: "fr-FR", speed: 0.5, emotionSource: "text" }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual({ ...wire, text: "{{happy}}Bonjour", language: "fr-fr", speechRate: 2, break_clone: true,
      instruct_mode: true, reference_mode: "expressive", flash: false, srt: false, stream: true, direct_stream: true });
    return audio();
  } }));
});

test("native subtitle and billing metadata remain intact without invented timestamp association", async () => {
  const native = { id: "audio", credit_used: 0, billing: { units: 2 }, srt: "1\n00:00:00,000 --> 00:00:00,500\nHi\n" };
  const result = await Array.fromAsync(synthesize({ ...request, subtitleFormat: "srt" }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual({ ...wire, flash: false, srt: true, stream: true, direct_stream: true });
    return new Response(Uint8Array.of(1), { headers: { "content-type": "audio/mpeg", "x-reecho-response-data": JSON.stringify(native), "x-vocu-app-request-id": "trace" } });
  } }));
  expect(result).toEqual([Uint8Array.of(1), { event: "done", completion: "transport", metadata: native, requestId: "trace" }]);
});

test("JSON mode prefers native streamUrl and never forwards credentials to the download", async () => {
  let calls = 0;
  const native = { id: "audio", audio: "https://storage.vocu.ai/generate/final.mp3", streamUrl: "https://storage.vocu.ai/generate/stream.mp3?auth=owned", credit_used: 0 };
  const result = await Array.fromAsync(synthesize(request, { auth, mode: "http", fetch: async (url, init) => {
    calls++;
    if (calls === 1) {
      expect(JSON.parse(String(init?.body))).toEqual({ ...wire, flash: false, srt: false, stream: true, direct_stream: false });
      return data(native);
    }
    expect(String(url)).toBe(native.streamUrl);
    expect(init?.headers).toBeUndefined(); expect(init?.method).toBe("GET");
    expect([init?.credentials, init?.redirect]).toEqual(["omit", "error"]);
    return audio();
  } }));
  expect(calls).toBe(2);
  expect(result).toEqual([Uint8Array.of(0, 255, 128), { event: "done", completion: "transport", metadata: native }]);
});

test("one native batch traverses pending and processing before downloading the merged file", async () => {
  const urls: string[] = [];
  const result = await Array.fromAsync(synthesize({ segments: [{ kind: "speech", ...request }, { kind: "speech", voice: "owned", text: "{{quiet}}Two", inputType: "markup" }] }, {
    auth: { vocu: { accessToken: "session" } }, pollIntervalMs: 0, fetch: async (url, init) => {
      urls.push(String(url));
      if (urls.length < 4) expect(new Headers(init?.headers).get("authorization")).toBe("Bearer session");
      if (urls.length === 1) {
        expect(JSON.parse(String(init?.body))).toEqual({ contents: [{ type: "text", ...wire }, { type: "text", ...wire, voiceId: "owned", text: "{{quiet}}Two", instruct_mode: true }], srt: false });
        return data({ id: "job", status: "pending", metadata: { audio: "https://evil.test/not-ready" } });
      }
      if (urls.length === 2) return data({ id: "job", status: "processing" });
      if (urls.length === 3) return data(generated);
      expect(init?.headers).toBeUndefined(); return audio();
    },
  }));
  expect(urls).toEqual(["https://v1.vocu.ai/api/tts/generate", "https://v1.vocu.ai/api/tts/generate/job", "https://v1.vocu.ai/api/tts/generate/job", generated.metadata.audio]);
  expect(result).toEqual([Uint8Array.of(0, 255, 128), { event: "done", completion: "generated", metadata: generated }]);
});

test("single input can explicitly choose async submission without sending dropped flash/stream controls", async () => {
  let calls = 0;
  await Array.fromAsync(synthesize(request, { auth, mode: "async", fetch: async (_url, init) => {
    if (++calls === 1) { expect(JSON.parse(String(init?.body))).toEqual({ contents: [{ type: "text", ...wire }], srt: false }); return data(generated); }
    return audio();
  } }));
  expect(calls).toBe(2);
});

test("saved text splitter is mutually exclusive with explicit segments and requires no voice", async () => {
  let calls = 0;
  await Array.fromAsync(synthesize({ text: "[Alice] Hello", textSplitter: { id: "saved" }, subtitleFormat: "srt" }, { auth, fetch: async (_url, init) => {
    if (++calls === 1) { expect(JSON.parse(String(init?.body))).toEqual({ text: "[Alice] Hello", splitterId: "saved", srt: true }); return data(generated); }
    return audio();
  } }));
  expect(calls).toBe(2);
});

test("inline text splitting preserves inheritance, literal markers and lookup priority", async () => {
  let calls = 0;
  await Array.fromAsync(synthesize({ text: "[Alice] Hello", textSplitter: {
    placeholders: [{ marker: "[Alice]", voice: "alice", speed: 2 }, { marker: "__proto__", emotionSource: "voice" }],
    brackets: [{ open: "[", close: "]" }, { open: "【", close: "】" }],
    fallback: { voice: "narrator", randomSeed: 0 },
    lookup: [{ tags: ["angry", ["Alice", "sad"]], emotionBlend: { anger: 10 } }, { tags: ["Alice"], inputType: "markup", referenceEmphasis: "similarity" }],
  } }, { auth, fetch: async (_url, init) => {
    if (++calls === 1) {
      const expected = JSON.parse('{"[Alice]":{"voiceId":"alice","speechRate":0.5},"__proto__":{"break_clone":false},"splitterMarks":["[]","【】"],"fallbackConfig":{"voiceId":"narrator","seed":0},"lookupTable":{"entry0":{"emo_switch":[10,0,0,0,0],"tags":["angry",["Alice","sad"]]},"entry1":{"instruct_mode":true,"reference_mode":"similarity","tags":["Alice"]}}}');
      expect(JSON.parse(String(init?.body))).toEqual({ text: "[Alice] Hello", splitter: expected, srt: false });
      return data(generated);
    }
    return audio();
  } }));
  expect(calls).toBe(2);
});

test("an empty placeholder list is valid alongside a fallback binding", async () => {
  let calls = 0;
  await Array.fromAsync(synthesize({ text: "Hello", textSplitter: { placeholders: [], fallback: { voice: "owned" } } }, { auth, fetch: async (_url, init) => {
    if (++calls === 1) { expect(JSON.parse(String(init?.body))).toEqual({ text: "Hello", splitter: { fallbackConfig: { voiceId: "owned" } }, srt: false }); return data(generated); }
    return audio();
  } }));
  expect(calls).toBe(2);
});

test.each(["lookupTable", "fallbackConfig", "splitterMarks", "duplicate"])("inline splitter detects native key collision %s", async marker => {
  const placeholders = marker === "duplicate" ? [{ marker }, { marker }] : [{ marker }];
  await expect(synthesize({ text: "Hello", textSplitter: { placeholders } }, { auth, fetch: async () => { throw new Error("Network must not run"); } }).next()).rejects.toEqual(new TypeError("Vocu splitter markers must be unique and cannot use reserved protocol keys"));
});

test.each([
  { ...request, text: "  " }, { ...request, voice: "" }, { ...request, voiceStyle: "" }, { ...request, model: "v3.5" },
  { ...request, language: "en" }, { ...request, randomSeed: 2147483648 }, { ...request, randomSeed: null }, { ...request, randomSeed: 0.5 },
  { ...request, speed: 0.4 }, { ...request, emotionBlend: { anger: 11 } }, { ...request, emotionBlend: { happiness: 1.5 } },
  { ...request, inputType: "markup", subtitleFormat: "srt" }, { ...request, referenceEmphasis: "similarity" },
  { ...request, latencyOptimization: "maximum", subtitleFormat: "srt" }, { ...request, output: { format: "wav" } },
  { ...request, output: { format: "mp3", sampleRateHz: 44100 } }, { ...request, referenceAudio: Uint8Array.of(1) },
  { ...request, timestampGranularity: "word" }, { ...request, text: (async function* () { yield "hi"; })() },
  { segments: [] }, { segments: new Array(1) }, { segments: [{ kind: "pause", pauseMs: 1 }] },
  { segments: [{ kind: "speech", ...request, latencyOptimization: "maximum" }] },
  { segments: [{ kind: "speech", ...request, inputType: "markup" }], subtitleFormat: "srt" },
  { text: "Hello", voice: "wrong", textSplitter: { id: "saved" } }, { ...request, segments: [{ kind: "speech", ...request }] },
  { text: "Hello", textSplitter: {} }, { text: "Hello", textSplitter: { placeholders: [] } },
  { text: "Hello", textSplitter: { id: "saved", fallback: { voice: "wrong" } } },
  { text: "Hello", textSplitter: { fallback: {} } },
  { text: "Hello", textSplitter: { brackets: [{ open: "[[", close: "]" }] } },
  { text: "Hello", textSplitter: { brackets: [], lookup: [{ tags: [] }] } },
  { text: "Hello", textSplitter: { fallback: { voice: "owned", inputType: "markup" } }, subtitleFormat: "srt" },
] as const)("generated validator rejects unsupported combination %#", value => {
  assert.throws(() => validateRequest(value), { name: "TypeError", message: "Invalid vocu TTS request" });
});

test.each([
  [{ segments: [{ kind: "speech", ...request }] }, { mode: "stream" }, "Vocu segments and text splitting require async synthesis"],
  [{ ...request, latencyOptimization: "maximum" }, { mode: "async" }, "Vocu async synthesis does not support flash latency optimization"],
  [request, { pollIntervalMs: -1 }, "Vocu polling interval and timeout must be integers between 0 and 2147483647"],
  [request, { maxMetadataBytes: 0 }, "Vocu maxMetadataBytes must be a positive safe integer"],
  [request, { mode: "wrong" }, "Invalid Vocu mode"],
  [request, { audioOrigins: ["https://audio.test/path"] }, "Vocu audioOrigins must contain HTTP(S) origins only"],
] as const)("boundary rejects incompatible override %# before network activity", async (value, options, message) => {
  await expect(synthesize(value as TtsRequest, { ...options, auth, fetch: async () => { throw new Error("Network must not run"); } } as Parameters<typeof synthesize>[1]).next()).rejects.toEqual(new TypeError(message));
});

test.each(["https://evil.test/audio.mp3", "http://127.0.0.1/secret", "https://storage.vocu.ai.evil.test/audio", "https://key:secret@storage.vocu.ai/audio", "https://storage.vocu.ai/audio#fragment"])("rejects untrusted native asset address %s", async address => {
  let calls = 0;
  await expect(Array.fromAsync(synthesize(request, { auth, mode: "http", fetch: async () => { calls++; return data({ audio: address }); } }))).rejects.toEqual(new TypeError("Vocu returned an untrusted audio URL"));
  expect(calls).toBe(1);
});

test.each([
  [{ id: "../other", status: "pending" }, "Invalid Vocu job ID"],
  [{ id: "job", status: "unknown" }, "Invalid Vocu job status"],
  [{ id: "job", status: "generated", metadata: {} }, "Vocu returned no audio URL"],
] as const)("malformed job fails without downloading or resubmitting %#", async (job, message) => {
  let calls = 0;
  await expect(Array.fromAsync(synthesize(request, { auth, mode: "async", fetch: async () => { calls++; return data(job); } }))).rejects.toEqual(new TypeError(message));
  expect(calls).toBe(1);
});

test("native failed job exposes identity and never deletes or resubmits it", async () => {
  let calls = 0;
  await expect(Array.fromAsync(synthesize(request, { auth, mode: "async", fetch: async () => { calls++; return data({ id: "job", status: "failed" }); } }))).rejects.toEqual(new VocuError(null, "job", null, null));
  expect(calls).toBe(1);
});

test("changed polling identity is rejected", async () => {
  let calls = 0;
  await expect(Array.fromAsync(synthesize(request, { auth, mode: "async", pollIntervalMs: 0, fetch: async () => data(++calls === 1 ? { id: "job", status: "pending" } : { ...generated, id: "other" }) }))).rejects.toEqual(new TypeError("Vocu returned a different job ID while polling"));
  expect(calls).toBe(2);
});

test("HTTP failures cancel their body and retain safe status, request ID and retry hint", async () => {
  let cancelled = false;
  await expect(synthesize(request, { auth, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 429, headers: { "x-vocu-app-request-id": "trace", "retry-after": "5" } }) }).next()).rejects.toEqual(new VocuError(429, null, "trace", "5"));
  expect(cancelled).toBe(true);
});

test.each([
  ["application/json", undefined, "Vocu returned an unexpected audio content type"],
  ["audio/mpeg", "null", "Invalid Vocu response object"],
  ["audio/mpeg", '{"credit_used":1e400}', "Invalid Vocu metadata"],
] as const)("invalid response headers release the audio body %#", async (type, header, message) => {
  let cancelled = false;
  await expect(synthesize(request, { auth, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": type, ...(header === undefined ? {} : { "x-reecho-response-data": header }) } }) }).next()).rejects.toEqual(new TypeError(message));
  expect(cancelled).toBe(true);
});

test("empty audio is not successful completion", async () => {
  await expect(synthesize(request, { auth, fetch: async () => new Response(new Uint8Array()) }).next()).rejects.toEqual(new TypeError("Vocu returned no audio"));
});

test("bounded metadata rejects oversized JSON and cancels pending remainder", async () => {
  let cancelled = false;
  await expect(synthesize(request, { auth, mode: "http", maxMetadataBytes: 3, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"status":')); }, cancel() { cancelled = true; } })) }).next()).rejects.toEqual(new TypeError("Vocu metadata exceeds maxMetadataBytes"));
  expect(cancelled).toBe(true);
});

test("first chunk arrives before EOF and iterator return releases the upstream body", async () => {
  let cancelled = false;
  const stream = synthesize(request, { auth, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; } })) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  await stream.return?.(); expect(cancelled).toBe(true);
});

test("abort interrupts uncooperative pending reads and does not emit completion", async () => {
  const controller = new AbortController(); let cancelled = false;
  const stream = synthesize(request, { auth, signal: controller.signal, fetch: async () => new Response(new ReadableStream({ start(output) { output.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; } })) });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  const pending = stream.next(); controller.abort(new Error("stop"));
  await expect(pending).rejects.toEqual(new Error("stop")); expect(cancelled).toBe(true);
});

test("deadline interrupts uncooperative fetch and releases a late response", async () => {
  const deferred = Promise.withResolvers<Response>(); let cancelled = false;
  await expect(synthesize(request, { auth, timeoutMs: 5, fetch: () => deferred.promise }).next()).rejects.toEqual(new DOMException("Vocu synthesis deadline expired", "TimeoutError"));
  deferred.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await Promise.resolve(); await Promise.resolve(); expect(cancelled).toBe(true);
});

test("abort interrupts a polling delay without deleting the native job", async () => {
  const controller = new AbortController(); const submitted = Promise.withResolvers<void>(); const calls: string[] = [];
  const pending = synthesize(request, { auth, mode: "async", pollIntervalMs: 60000, signal: controller.signal, fetch: async (url, init) => {
    calls.push(`${init?.method} ${url}`); submitted.resolve(); return data({ id: "job", status: "pending" });
  } }).next();
  await submitted.promise; controller.abort(new Error("stop polling"));
  await expect(pending).rejects.toEqual(new Error("stop polling"));
  expect(calls).toEqual(["POST https://v1.vocu.ai/api/tts/generate"]);
});

test("explicit async session authentication wins over an environment API key", async () => {
  const previous = process.env.SPEECHSWITCH_VOCU_API_KEY; process.env.SPEECHSWITCH_VOCU_API_KEY = "environment-key";
  let calls = 0;
  try {
    await Array.fromAsync(synthesize(request, { mode: "async", auth: { vocu: { accessToken: "explicit-session" } }, fetch: async (_url, init) => {
      if (++calls === 1) { expect(new Headers(init?.headers).get("authorization")).toBe("Bearer explicit-session"); return data(generated); }
      return audio();
    } }));
  } finally { if (previous === undefined) delete process.env.SPEECHSWITCH_VOCU_API_KEY; else process.env.SPEECHSWITCH_VOCU_API_KEY = previous; }
  expect(calls).toBe(2);
});

test("an explicitly empty API key is not replaced with a session token for simple synthesis", async () => {
  await expect(synthesize(request, { auth: { vocu: { apiKey: "", accessToken: "session" } }, fetch: async () => { throw new Error("Network must not run"); } }).next()).rejects.toEqual(new TypeError("Missing auth.vocu.apiKey configuration"));
});

test("zero deadline and pre-abort fail before submission", async () => {
  const controller = new AbortController(); controller.abort(new Error("already stopped"));
  const fetch = async () => { throw new Error("Network must not run"); };
  await expect(synthesize(request, { auth, fetch, signal: controller.signal }).next()).rejects.toEqual(new Error("already stopped"));
  await expect(synthesize(request, { auth, fetch, timeoutMs: 0 }).next()).rejects.toEqual(new DOMException("Vocu synthesis deadline expired", "TimeoutError"));
});

test("abort after the final audio chunk still excludes a done event", async () => {
  const controller = new AbortController();
  const stream = synthesize(request, { auth, signal: controller.signal, fetch: async () => audio() });
  expect(await stream.next()).toEqual({ done: false, value: Uint8Array.of(0, 255, 128) });
  controller.abort(new Error("stop"));
  await expect(stream.next()).rejects.toEqual(new Error("stop"));
});

test("oversized header metadata releases the response body", async () => {
  let cancelled = false;
  await expect(synthesize(request, { auth, maxMetadataBytes: 2, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "x-reecho-response-data": '{"id":"audio"}' } }) }).next()).rejects.toEqual(new TypeError("Vocu metadata exceeds maxMetadataBytes"));
  expect(cancelled).toBe(true);
});
