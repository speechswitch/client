import { expect, test } from "bun:test";
import { synthesize, OpenaiError, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";

const common = { text: "Hello", voice: "alloy" } as const;
const mini = { ...common, model: "gpt-4o-mini-tts", includeUsage: true } as const;
const auth = { openai: { apiKey: "test-key" } };
function audio() { return new Response(Uint8Array.of(0, 255, 128), { headers: { "Content-Type": "application/octet-stream" } }); }
function event(type: string, fields: object) { return `event: ${type}\r\ndata: ${JSON.stringify({ type, ...fields })}\r\n\r\n`; }
const delta = event("speech.audio.delta", { audio: "AQI=" });
const done = event("speech.audio.done", { usage: { input_tokens: 0, output_tokens: 1, total_tokens: 1 } });
function sse(text: string) {
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8", "x-request-id": "req-test" } });
}
test("OpenAI browser bundle has no Node transport or third-party runtime imports", async () => {
  const result = await Bun.build({ entrypoints: [new URL("./index.ts", import.meta.url).pathname], target: "browser" });
  expect(result.success).toBe(true); expect(result.logs).toEqual([]);
});
test("OpenAI dispatch streams binary bytes before completion with resolved defaults and header auth", async () => {
  let finish!: () => void;
  const result = dispatch("openai", common, { auth, baseUrl: "https://proxy.invalid/root/v1/?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://proxy.invalid/root/v1/audio/speech?tenant=one");
    expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json", Accept: "application/octet-stream, text/event-stream" });
    expect(JSON.parse(init?.body as string)).toEqual({ model: "tts-1", input: "Hello", voice: "alloy", response_format: "pcm", speed: 1, stream_format: "audio" });
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Uint8Array.of(0, 255)); finish = () => { controller.enqueue(Uint8Array.of(128)); controller.close(); };
    } }), { headers: { "Content-Type": "audio/pcm", "x-request-id": "req-binary" } });
  } });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(0, 255) }); finish();
  expect(await Array.fromAsync(result)).toEqual([Uint8Array.of(128), { event: "done", requestId: "req-binary" }]);
});
test.each([
  { ...common, model: "tts-1" }, { ...common, model: "tts-1-hd" }, { ...common, model: "gpt-4o-mini-tts" },
  { ...common, model: "gpt-4o-mini-tts-2025-03-20" }, { ...common, model: "gpt-4o-mini-tts-2025-12-15" },
] as const)("OpenAI preserves explicit model %#", async request => {
  await Array.fromAsync(synthesize(request, { auth, fetch: async (_, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({ model: request.model, input: "Hello", voice: "alloy", response_format: "pcm", speed: 1, stream_format: "audio" }); return audio();
  } }));
});
test("OpenAI distinguishes saved custom voices explicitly without guessing prefixes", async () => {
  const request = { ...common, model: "gpt-4o-mini-tts", voiceSource: "custom", instructions: "Whisper", speed: 0.25 } as const;
  const result = await Array.fromAsync(synthesize(request, { auth, fetch: async (_, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({ model: "gpt-4o-mini-tts", input: "Hello", voice: { id: "alloy" }, instructions: "Whisper", speed: 0.25, response_format: "pcm", stream_format: "audio" }); return audio();
  } }));
  expect(result).toEqual([Uint8Array.of(0, 255, 128), { event: "done" }]);
  expect(request.voice).toBe("alloy"); expect(request.voiceSource).toBe("custom");
});
test.each(["pcm", "mp3", "wav", "flac", "aac", "opus"] as const)("OpenAI maps %s without invented sample controls", async format => {
  await Array.fromAsync(synthesize({ ...common, output: { format }, speed: 4 }, { auth, fetch: async (_, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({ model: "tts-1", input: "Hello", voice: "alloy", response_format: format, speed: 4, stream_format: "audio" }); return audio();
  } }));
});
test("OpenAI SSE streams audio before completion and preserves native zero-valued usage", async () => {
  let finish!: () => void;
  const result = synthesize(mini, { auth, fetch: async (_, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({ model: "gpt-4o-mini-tts", input: "Hello", voice: "alloy", response_format: "pcm", speed: 1, stream_format: "sse" });
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(delta)); finish = () => { controller.enqueue(new TextEncoder().encode(done)); controller.close(); };
    } }), { headers: { "Content-Type": "text/event-stream" } });
  } });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) }); finish();
  expect(await Array.fromAsync(result)).toEqual([{ event: "done", usage: { inputTokens: 0, outputTokens: 1, totalTokens: 1 } }]);
});
test("OpenAI SSE decodes fragmented UTF-8, skips empty audio and accepts data-only event framing", async () => {
  const response = sse(": 你好\r\n\r\n" + event("speech.audio.delta", { audio: "" }) + `data: ${JSON.stringify({ type: "speech.audio.delta", audio: "AQI=" })}\r\n\r\n` + done);
  expect(await Array.fromAsync(synthesize(mini, { auth, fetch: async () => response }))).toEqual([
    Uint8Array.of(1, 2), { event: "done", requestId: "req-test", usage: { inputTokens: 0, outputTokens: 1, totalTokens: 1 } },
  ]);
});
test.each([
  [() => sse(delta), "OpenAI speech stream ended before speech.audio.done"],
  [() => sse(done), "OpenAI returned no audio"],
  [() => sse(event("speech.audio.delta", { audio: "not_base64" })), "OpenAI returned invalid base64 audio"],
  [() => sse(event("speech.audio.done", { usage: { input_tokens: 0 } })), "Invalid OpenAI speech event"],
  [() => sse(event("speech.audio.done", { usage: { input_tokens: null, output_tokens: 1, total_tokens: 1 } })), "Invalid OpenAI speech event"],
  [() => sse('event: wrong\ndata: {"type":"speech.audio.delta","audio":"AQI="}\n\n'), "OpenAI returned conflicting SSE event types"],
  [() => audio(), "OpenAI returned no SSE usage stream"],
] as const)("OpenAI rejects malformed or incomplete SSE %#", async (response, message) => {
  expect(await Array.fromAsync(synthesize(mini, { auth, fetch: async () => response() })).catch(error => error)).toEqual(new TypeError(message));
});
test.each([
  [() => new Response(new Uint8Array()), "OpenAI returned no audio"],
  [() => Response.json({ error: "failure" }), "OpenAI returned a non-audio response"],
  [() => sse(delta + done), "OpenAI returned a non-audio response"],
] as const)("OpenAI rejects invalid binary response %#", async (response, message) => {
  expect(await Array.fromAsync(synthesize(common, { auth, fetch: async () => response() })).catch(error => error)).toEqual(new TypeError(message));
});
test("OpenAI preserves opaque HTTP errors, request identity and retry information", async () => {
  const body = '{"error":{"message":"quota"}}';
  const failure = await Array.fromAsync(synthesize(common, { auth, fetch: async () => new Response(body, { status: 429, headers: { "x-request-id": "req-error", "Retry-After": "10" } }) })).catch(error => error);
  expect(failure).toEqual(new OpenaiError(429, body, "req-error", "10"));
  expect([failure.statusCode, failure.body, failure.requestId, failure.retryAfter]).toEqual([429, body, "req-error", "10"]);
});
test.each([false, true])("OpenAI consumer return releases unfinished response with usage %s", async includeUsage => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(includeUsage ? new TextEncoder().encode(delta) : Uint8Array.of(1, 2)); }, cancel() { cancelled++; } });
  const result = synthesize({ ...mini, includeUsage }, { auth, fetch: async () => new Response(body, { headers: { "Content-Type": includeUsage ? "text/event-stream" : "application/octet-stream" } }) });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) }); await result.return!(undefined);
  expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
test.each(["audio", "sse", "error"] as const)("OpenAI abort interrupts pending %s body reads", async mode => {
  const controller = new AbortController(); const reason = new Error("stop"); let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const pending = Array.fromAsync(synthesize({ ...mini, includeUsage: mode === "sse" }, { auth, signal: controller.signal, fetch: async () => new Response(body, { status: mode === "error" ? 503 : 200, headers: { "Content-Type": mode === "sse" ? "text/event-stream" : "application/octet-stream" } }) }));
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(reason);
  expect(await pending.catch(error => error)).toBe(reason); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
test("OpenAI deadline interrupts an uncooperative fetch and cancels its late body", async () => {
  let resolve!: (response: Response) => void; let cancelled = 0;
  const pending = new Promise<Response>(done => { resolve = done; });
  const failure = await Array.fromAsync(synthesize(common, { auth, timeoutMs: 5, fetch: () => pending })).catch(error => error);
  expect(failure).toEqual(new DOMException("OpenAI speech deadline expired", "TimeoutError"));
  resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await new Promise(done => setTimeout(done, 0)); expect(cancelled).toBe(1);
});
test("OpenAI rejects invalid normalized requests before network access", async () => {
  let calls = 0;
  const failure = await Array.fromAsync(synthesize({ ...common, instructions: "Whisper" } as TtsRequest, { auth, fetch: async () => { calls++; return audio(); } })).catch(error => error);
  expect(failure).toEqual(new TypeError("Invalid openai TTS request")); expect(calls).toBe(0);
});
test("OpenAI resolves explicit auth before scoped and vendor environment fallbacks", async () => {
  const names = ["SPEECHSWITCH_OPENAI_API_KEY", "OPENAI_API_KEY"] as const; const previous = names.map(name => process.env[name]);
  process.env.SPEECHSWITCH_OPENAI_API_KEY = "scoped-key"; process.env.OPENAI_API_KEY = "vendor-key";
  const headers: (string | null)[] = [];
  const fetch = async (_: unknown, init?: RequestInit) => { headers.push(new Headers(init?.headers).get("Authorization")); return audio(); };
  try {
    await Array.fromAsync(synthesize(common, { auth, fetch })); await Array.fromAsync(synthesize(common, { fetch }));
    delete process.env.SPEECHSWITCH_OPENAI_API_KEY; await Array.fromAsync(synthesize(common, { fetch })); delete process.env.OPENAI_API_KEY;
    expect(await Array.fromAsync(synthesize(common, { fetch })).catch(error => error)).toEqual(new TypeError("Missing auth.openai.apiKey configuration"));
    expect(headers).toEqual(["Bearer test-key", "Bearer scoped-key", "Bearer vendor-key"]);
  } finally { names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); }
});
