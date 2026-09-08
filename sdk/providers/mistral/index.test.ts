import { expect, test } from "bun:test";
import { synthesize, MistralError, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";

const common = { text: "Hello", voice: "saved-custom-voice" };
const auth = { mistral: { apiKey: "test-key" } };
test("Mistral browser bundle has no Node transport or third-party runtime imports", async () => {
  const result = await Bun.build({ entrypoints: [new URL("./index.ts", import.meta.url).pathname], target: "browser" });
  expect(result.success).toBe(true); expect(result.logs).toEqual([]);
});
function event(type: string, data: object) { return `event: ${type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`; }
function success() { return Response.json({ audio_data: "AP+A" }); }
function stream(text: string) {
  const data = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}
test("Mistral dispatch streams audio before completion and resolves PCM defaults at the boundary", async () => {
  let finish!: () => void;
  const result = dispatch("mistral", common, { auth, baseUrl: "https://proxy.invalid/root?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://proxy.invalid/root/v1/audio/speech?tenant=one");
    expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json", Accept: "text/event-stream, application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({ model: "voxtral-mini-tts-2603", input: "Hello", voice_id: common.voice, response_format: "pcm", stream: true });
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(event("speech.audio.delta", { audio_data: "AQI=" })));
      finish = () => { controller.enqueue(new TextEncoder().encode(event("speech.audio.done", { usage: { prompt_tokens: 0, completion_tokens: null, total_tokens: 1 } }))); controller.close(); };
    } }), { headers: { "Content-Type": "text/event-stream" } });
  } });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) }); finish();
  expect(await Array.fromAsync(result)).toEqual([{ event: "done", usage: { promptTokens: 0, completionTokens: null, totalTokens: 1 } }]);
});
test("Mistral maps complete reference bytes, metadata and cache affinity without mutating input", async () => {
  const metadata = { trace: { labels: ["one", null], enabled: false, count: 0 } };
  const request = { ...common, referenceAudio: Uint8Array.of(0, 255, 128), metadata, promptCacheKey: "cache-1" };
  const actual = await Array.fromAsync(synthesize(request, { auth, fetch: async (_, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({ model: "voxtral-mini-tts-2603", input: "Hello", voice_id: common.voice, ref_audio: "AP+A", metadata,
      prompt_cache_key: "cache-1", response_format: "pcm", stream: true }); return success();
  } }));
  expect(actual).toEqual([Uint8Array.of(0, 255, 128), { event: "done" }]);
  expect(request).toEqual({ ...common, referenceAudio: Uint8Array.of(0, 255, 128), metadata: { trace: { labels: ["one", null], enabled: false, count: 0 } }, promptCacheKey: "cache-1" });
});
test.each(["pcm", "wav", "mp3", "flac", "opus"] as const)("Mistral forwards the documented %s format without invented parameters", async format => {
  await Array.fromAsync(synthesize({ text: "Hi", referenceAudio: Uint8Array.of(1), output: { format } }, { auth, fetch: async (_, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({ model: "voxtral-mini-tts-2603", input: "Hi", ref_audio: "AQ==", response_format: format, stream: true }); return success();
  } }));
});
test("Mistral SSE handles fragmented multibyte text, empty deltas, and typed completion", async () => {
  const actual = await Array.fromAsync(synthesize(common, { auth, fetch: async () => stream(
    ": heartbeat\r\n\r\n" + event("speech.audio.delta", { type: "speech.audio.delta", audio_data: "", comment: "你好" })
      + event("speech.audio.delta", { type: "speech.audio.delta", audio_data: "AQ==" })
      + event("speech.audio.delta", { type: "speech.audio.delta", audio_data: "Ag==" })
      + event("speech.audio.done", { type: "speech.audio.done", usage: {} }),
  ) }));
  expect(actual).toEqual([Uint8Array.of(1), Uint8Array.of(2), { event: "done", usage: {} }]);
});
test.each([
  [() => stream(event("speech.audio.delta", { audio_data: "AQ==" })), "Mistral speech stream ended before speech.audio.done"],
  [() => stream(event("speech.audio.done", { usage: {} })), "Mistral returned no audio"],
  [() => Response.json({ audio_data: "" }), "Mistral returned no audio"],
  [() => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }), "Mistral returned an unsupported response content type"],
  [() => stream(event("speech.audio.delta", { audio_data: "not_base64" })), "Mistral returned invalid base64 audio"],
] as const)("Mistral rejects incomplete or malformed response %#", async (response, message) => {
  expect(await Array.fromAsync(synthesize(common, { auth, fetch: async () => response() })).catch(error => error)).toEqual(new TypeError(message));
});
test("Mistral HTTP errors preserve status, complete opaque body and retry information", async () => {
  const body = '{"detail":"moderation or quota rejection"}';
  const failure = await Array.fromAsync(synthesize(common, { auth, fetch: async () => new Response(body, { status: 403, headers: { "Retry-After": "10" } }) })).catch(error => error);
  expect(failure).toEqual(new MistralError(403, body, "10"));
  expect([failure.statusCode, failure.body, failure.retryAfter]).toEqual([403, body, "10"]);
});
test("Mistral consumer return releases the SSE reader before upstream finishes", async () => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(event("speech.audio.delta", { audio_data: "AQ==" }))); }, cancel() { cancelled++; } });
  const result = synthesize(common, { auth, fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }) });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1) }); await result.return!(undefined);
  expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
test.each(["text/event-stream", "application/json", "text/plain"])("Mistral abort interrupts pending %s body reads", async contentType => {
  const controller = new AbortController(); const reason = new Error("stop reading"); let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const pending = Array.fromAsync(synthesize(common, { auth, signal: controller.signal, fetch: async () => new Response(body, { status: contentType === "text/plain" ? 429 : 200, headers: { "Content-Type": contentType } }) }));
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(reason);
  expect(await pending.catch(error => error)).toBe(reason); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
test("Mistral deadline interrupts an uncooperative fetch and cancels its late response", async () => {
  let resolve!: (response: Response) => void; let cancelled = 0;
  const pending = new Promise<Response>(done => { resolve = done; });
  const failure = await Array.fromAsync(synthesize(common, { auth, timeoutMs: 5, fetch: () => pending })).catch(error => error);
  expect(failure).toEqual(new DOMException("Mistral synthesis deadline expired", "TimeoutError"));
  resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await new Promise(done => setTimeout(done, 0)); expect(cancelled).toBe(1);
});
test("Mistral generated checks reject cyclic metadata before fetch", async () => {
  const metadata: { self?: unknown } = {}; metadata.self = metadata; let called = false;
  const failure = await Array.fromAsync(synthesize({ ...common, metadata } as TtsRequest, { auth, fetch: async () => { called = true; return success(); } })).catch(error => error);
  expect(failure).toEqual(new TypeError('Invalid mistral TTS request:\nrequest["metadata"]["self"]: expected JSON value')); expect(called).toBe(false);
});
test("Mistral explicit auth wins over scoped and vendor environment fallbacks", async () => {
  const names = ["SPEECHSWITCH_MISTRAL_API_KEY", "MISTRAL_API_KEY"] as const; const previous = names.map(name => process.env[name]);
  process.env.SPEECHSWITCH_MISTRAL_API_KEY = "scoped-key"; process.env.MISTRAL_API_KEY = "vendor-key";
  const headers: (string | null)[] = [];
  const fetch = async (_: unknown, init?: RequestInit) => { headers.push(new Headers(init?.headers).get("Authorization")); return success(); };
  try {
    await Array.fromAsync(synthesize(common, { auth, fetch })); await Array.fromAsync(synthesize(common, { fetch }));
    delete process.env.SPEECHSWITCH_MISTRAL_API_KEY; await Array.fromAsync(synthesize(common, { fetch }));
    delete process.env.MISTRAL_API_KEY;
    expect(await Array.fromAsync(synthesize(common, { fetch })).catch(error => error)).toEqual(new TypeError("Missing auth.mistral.apiKey configuration"));
    expect(headers).toEqual(["Bearer test-key", "Bearer scoped-key", "Bearer vendor-key"]);
  } finally { names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); }
});
