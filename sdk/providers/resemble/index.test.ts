import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { synthesize, ResembleError, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";

const auth = { resemble: { token: "hf-test" } };
const text = "Hello";
const savedFile = { path: "/tmp/gradio/file with?#雪.wav", meta: { _type: "gradio.FileData" } };
function complete(file: unknown = savedFile) { return `event: complete\r\ndata: ${JSON.stringify([file])}\r\n\r\n`; }
function sse(value: string) {
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of new TextEncoder().encode(value)) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}
function audio() { return new Response(Uint8Array.of(0, 255, 128), { headers: { "Content-Type": "audio/wav" } }); }
test("Resemble browser bundle has no Node or third-party runtime dependencies", async () => {
  const result = await Bun.build({ entrypoints: [new URL("./index.ts", import.meta.url).pathname], target: "browser" });
  expect(result.success).toBe(true); expect(result.logs).toEqual([]);
});
test("Resemble dispatch submits ordered inputs, waits for completion, then streams the download early", async () => {
  const calls: string[] = []; let finish!: () => void;
  const result = dispatch("resemble", { text }, { auth, baseUrl: "https://proxy.invalid/root/?tenant=one", fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer hf-test");
    expect(init?.redirect).toBe("error"); expect(init?.credentials).toBe("omit"); expect(url.search).toBe("?tenant=one");
    if (init?.method === "POST") {
      expect(url.pathname).toBe("/root/gradio_api/call/generate_tts_audio");
      expect(JSON.parse(init.body as string)).toEqual({ data: [text, null, 0.5, 0.8, 0, 0.5, false] });
      return Response.json({ event_id: "event-1" });
    }
    if (calls.length === 2) {
      expect(url.pathname).toBe("/root/gradio_api/call/generate_tts_audio/event-1");
      return sse(": 雪\r\n\r\nevent: heartbeat\r\ndata: null\r\n\r\n" + complete());
    }
    expect(url.pathname).toBe("/root/gradio_api/file=%2Ftmp%2Fgradio%2Ffile%20with%3F%23%E9%9B%AA.wav");
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Uint8Array.of(1, 2)); finish = () => { controller.enqueue(Uint8Array.of(3)); controller.close(); };
    } }), { headers: { "Content-Type": "audio/wav" } });
  } });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1, 2) }); expect(calls.length).toBe(3);
  finish(); expect(await Array.fromAsync(result)).toEqual([Uint8Array.of(3), { event: "done", requestId: "event-1" }]);
});
test.each([
  [{ text, referenceAudio: Uint8Array.of(0, 255), styleExaggeration: 2, voiceGuidance: 0.2, temperature: 5, referenceAudioTrimming: true, randomSeed: 0 }, "resembleai-chatterbox.hf.space", "generate_tts_audio", [text, { path: "/uploaded/audio", meta: { _type: "gradio.FileData" } }, 2, 5, 0, 0.2, true]],
  [{ text, model: "chatterbox-multilingual", language: "fr", referenceAudio: Uint8Array.of(0, 255) }, "resembleai-chatterbox-multilingual-tts-v3.hf.space", "generate_tts_audio", [text, { path: "/uploaded/audio", meta: { _type: "gradio.FileData" } }, "fr", 0.5, 0.8, 0, 0.5]],
  [{ text, model: "chatterbox-turbo", referenceAudio: Uint8Array.of(0, 255), minP: 0, topP: 0, topK: 0, loudnessNormalization: false }, "resembleai-chatterbox-turbo-demo.hf.space", "generate", [text, { path: "/uploaded/audio", meta: { _type: "gradio.FileData" } }, 0.8, 0, 0, 0, 0, 1.2, false]],
] as const)("Resemble model and reference upload map exactly %#", async (request, host, api, expected) => {
  let calls = 0;
  const result = await Array.fromAsync(synthesize(request, { auth, fetch: async (input, init) => {
    const url = new URL(String(input)); expect(url.hostname).toBe(host); calls++;
    if (calls === 1) {
      expect(url.pathname).toBe("/gradio_api/upload"); expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData; expect(Array.from(form.keys())).toEqual(["files"]);
      const file = form.get("files") as File; expect(file.name).toBe("reference.audio"); expect(file.type).toBe("application/octet-stream");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(Uint8Array.of(0, 255)); return Response.json(["/uploaded/audio"]);
    }
    if (calls === 2) { expect(url.pathname).toBe(`/gradio_api/call/${api}`); expect(JSON.parse(init?.body as string)).toEqual({ data: expected }); return Response.json({ event_id: "event" }); }
    if (calls === 3) return sse(complete());
    return audio();
  } }));
  expect(calls).toBe(4); expect(result).toEqual([Uint8Array.of(0, 255, 128), { event: "done", requestId: "event" }]);
});
test("Resemble Turbo resolves the live default reference, not the manifest's wrong generic example URL", async () => {
  const info = JSON.parse(readFileSync(new URL("../../../schemas/sources/resemble/02-gradio-schema.json", import.meta.url), "utf8"));
  info.named_endpoints["/generate"].parameters[1].parameter_default.path = "/new-cache/current.wav";
  let calls = 0;
  await Array.fromAsync(synthesize({ text, model: "chatterbox-turbo" }, { auth, fetch: async (input, init) => {
    calls++; const path = new URL(String(input)).pathname;
    if (calls === 1) { expect(path).toBe("/gradio_api/info"); return Response.json(info); }
    if (calls === 2) {
      expect(JSON.parse(init?.body as string)).toEqual({ data: [text, { path: "/new-cache/current.wav", meta: { _type: "gradio.FileData" } }, 0.8, 0, 0, 0.95, 1000, 1.2, true] });
      return Response.json({ event_id: "event" });
    }
    return calls === 3 ? sse(complete()) : audio();
  } })); expect(calls).toBe(4);
});
test("Resemble multilingual omission uses English and native reference fallback", async () => {
  let calls = 0;
  await Array.fromAsync(synthesize({ text, model: "chatterbox-multilingual" }, { auth, fetch: async (_, init) => {
    calls++; if (calls === 1) { expect(JSON.parse(init?.body as string)).toEqual({ data: [text, null, "en", 0.5, 0.8, 0, 0.5] }); return Response.json({ event_id: "event" }); }
    return calls === 2 ? sse(complete()) : audio();
  } })); expect(calls).toBe(3);
});
test("Resemble external audio URLs receive neither HF tokens nor browser cookies", async () => {
  let calls = 0;
  await Array.fromAsync(synthesize({ text }, { auth, fetch: async (input, init) => {
    calls++; if (calls === 1) return Response.json({ event_id: "event" });
    if (calls === 2) return sse(complete({ ...savedFile, url: "https://cdn.invalid/audio.wav" }));
    expect(String(input)).toBe("https://cdn.invalid/audio.wav"); expect(Array.from(new Headers(init?.headers))).toEqual([]);
    expect(init?.credentials).toBe("omit"); expect(init?.redirect).toBe("error"); return audio();
  } }));
});
test.each([
  ["", "Resemble event stream ended before completion"],
  ['event: complete\ndata: []\n\n', "Resemble returned an invalid output list"],
  ['event: complete\ndata: [null]\n\n', "Resemble returned an invalid audio file"],
  [complete({ path: "x", is_stream: true }), "Resemble returned an invalid audio file"],
  [complete({ path: "x", meta: { _type: "wrong" } }), "Resemble returned an invalid audio file"],
  [complete({ path: "x", url: "file:///etc/passwd" }), "Resemble returned an unsafe audio URL"],
  [complete({ path: "x", url: "http://external.invalid/audio.wav" }), "Resemble returned an unsafe audio URL"],
  [complete({ path: "x", url: "https://user:password@external.invalid/audio.wav" }), "Resemble returned an unsafe audio URL"],
  ['event: generating\ndata: []\n\n', "Unexpected Resemble event: generating"],
] as const)("Resemble rejects incomplete or malformed results %#", async (body, message) => {
  let calls = 0;
  const failure = await Array.fromAsync(synthesize({ text }, { auth, fetch: async () => ++calls === 1 ? Response.json({ event_id: "event" }) : sse(body) })).catch(error => error);
  expect(failure).toEqual(new TypeError(message)); expect(calls).toBe(2);
});
test("Resemble preserves queue errors without claiming successful completion", async () => {
  let calls = 0;
  const failure = await Array.fromAsync(synthesize({ text }, { auth, fetch: async () => ++calls === 1 ? Response.json({ event_id: "event" }) : sse('event: error\ndata: "GPU quota exhausted"\n\n') })).catch(error => error);
  expect(failure).toEqual(new ResembleError(null, '"GPU quota exhausted"', "event"));
  expect([failure.body, failure.requestId, failure.statusCode]).toEqual(['"GPU quota exhausted"', "event", null]);
});
test("Resemble preserves opaque HTTP errors and Retry-After", async () => {
  const failure = await Array.fromAsync(synthesize({ text }, { auth, fetch: async () => new Response("queue full", { status: 429, headers: { "Retry-After": "5" } }) })).catch(error => error);
  expect(failure).toEqual(new ResembleError(429, "queue full", null, "5"));
  expect([failure.statusCode, failure.body, failure.retryAfter]).toEqual([429, "queue full", "5"]);
});
test.each([{ value: [] }, { value: ["one", "two"] }, { value: [null] }, { value: [""] }])("Resemble rejects malformed upload lists %#", async ({ value }) => {
  let calls = 0;
  const failure = await Array.fromAsync(synthesize({ text, referenceAudio: Uint8Array.of(1) }, { auth, fetch: async () => { calls++; return Response.json(value); } })).catch(error => error);
  expect(failure).toEqual(new TypeError("Resemble returned an invalid upload path")); expect(calls).toBe(1);
});
test.each([{}, { event_id: "" }, { event_id: "." }, { event_id: ".." }])("Resemble rejects invalid queue identity %#", async value => {
  let calls = 0;
  const failure = await Array.fromAsync(synthesize({ text }, { auth, fetch: async () => { calls++; return Response.json(value); } })).catch(error => error);
  expect(failure).toEqual(new TypeError("Resemble returned an invalid event ID")); expect(calls).toBe(1);
});
test("Resemble consumer return closes a pending download", async () => {
  let calls = 0; let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled++; } });
  const result = synthesize({ text }, { auth, fetch: async () => ++calls === 1 ? Response.json({ event_id: "event" }) : calls === 2 ? sse(complete()) : new Response(body) });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1) }); await result.return!(undefined);
  expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
test.each(["submit", "queue", "download", "error"] as const)("Resemble abort releases pending %s body reads", async stage => {
  let calls = 0; let cancelled = 0; const controller = new AbortController(); const reason = new Error("stop");
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const pending = Array.fromAsync(synthesize({ text }, { auth, signal: controller.signal, fetch: async () => {
    calls++;
    if (stage === "submit") return new Response(body);
    if (stage === "error") return new Response(body, { status: 503 });
    if (calls === 1) return Response.json({ event_id: "event" });
    if (stage === "queue") return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    return calls === 2 ? sse(complete()) : new Response(body);
  } }));
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(reason);
  expect(await pending.catch(error => error)).toBe(reason); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
test("Resemble timeout cancels late responses from uncooperative fetch overrides", async () => {
  let resolve!: (response: Response) => void; let cancelled = 0;
  const pending = new Promise<Response>(done => { resolve = done; });
  const failure = await Array.fromAsync(synthesize({ text }, { auth, timeoutMs: 5, fetch: () => pending })).catch(error => error);
  expect(failure).toEqual(new DOMException("Resemble synthesis deadline expired", "TimeoutError"));
  resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await new Promise(done => setTimeout(done, 0)); expect(cancelled).toBe(1);
});
test("Resemble schema rejects invalid requests before network or reference upload", async () => {
  let calls = 0;
  const external: unknown = { text, model: "chatterbox-turbo", voiceGuidance: 0.5 };
  const failure = await Array.fromAsync(synthesize(external as TtsRequest, { auth, fetch: async () => { calls++; return audio(); } })).catch(error => error);
  expect(failure).toEqual(new TypeError("Invalid resemble TTS request")); expect(calls).toBe(0);
});
test("Resemble resolves explicit token, scoped environment, HF_TOKEN, then public access", async () => {
  const names = ["SPEECHSWITCH_RESEMBLE_TOKEN", "HF_TOKEN"] as const; const previous = names.map(name => process.env[name]);
  const authorization: (string | null)[] = []; let calls = 0;
  const fetch = async (_: unknown, init?: RequestInit) => {
    const stage = calls++ % 3; if (stage === 0) { authorization.push(new Headers(init?.headers).get("Authorization")); return Response.json({ event_id: "event" }); }
    return stage === 1 ? sse(complete()) : audio();
  };
  try {
    process.env.SPEECHSWITCH_RESEMBLE_TOKEN = "scoped"; process.env.HF_TOKEN = "vendor";
    await Array.fromAsync(synthesize({ text }, { auth, fetch })); await Array.fromAsync(synthesize({ text }, { fetch }));
    delete process.env.SPEECHSWITCH_RESEMBLE_TOKEN; await Array.fromAsync(synthesize({ text }, { fetch }));
    delete process.env.HF_TOKEN; await Array.fromAsync(synthesize({ text }, { fetch }));
    expect(authorization).toEqual(["Bearer hf-test", "Bearer scoped", "Bearer vendor", null]);
  } finally { names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); }
});
test("Resemble relative audio URLs preserve a deployment path prefix", async () => {
  let calls = 0;
  await Array.fromAsync(synthesize({ text }, { auth, baseUrl: "https://proxy.invalid/root", fetch: async (input) => {
    calls++; if (calls === 1) return Response.json({ event_id: "event" });
    if (calls === 2) return sse(complete({ path: "audio", url: "gradio_api/file=audio.wav?signature=test" }));
    expect(String(input)).toBe("https://proxy.invalid/root/gradio_api/file=audio.wav?signature=test"); return audio();
  } }));
});
test.each([{}, { named_endpoints: {} }, { named_endpoints: { "/generate": { parameters: [] } } }])("Resemble refuses to guess a missing Turbo default recording %#", async info => {
  let calls = 0;
  const failure = await Array.fromAsync(synthesize({ text, model: "chatterbox-turbo" }, { auth, fetch: async () => { calls++; return Response.json(info); } })).catch(error => error);
  expect(failure).toEqual(new TypeError("Resemble returned no default reference recording")); expect(calls).toBe(1);
});
test.each([
  [() => Response.json({ error: "login" }), "Resemble returned no audio stream"],
  [() => new Response(new Uint8Array()), "Resemble returned empty audio"],
] as const)("Resemble rejects unusable completed audio %#", async (response, message) => {
  let calls = 0;
  const failure = await Array.fromAsync(synthesize({ text }, { auth, fetch: async () => ++calls === 1 ? Response.json({ event_id: "event" }) : calls === 2 ? sse(complete()) : response() })).catch(error => error);
  expect(failure).toEqual(new TypeError(message)); expect(calls).toBe(3);
});
