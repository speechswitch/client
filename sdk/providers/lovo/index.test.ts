import { expect, test } from "bun:test";
import { synthesize, LovoError } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import fixture from "../../../sdks/fixtures/lovo.json";

test("LOVO uses the cross-language request, job and file-correlation fixture", async () => {
  let count = 0;
  const items = await Array.fromAsync(synthesize(fixture.request, { auth: { lovo: { apiKey: "test-key" } }, fetch: async (_url, init) => {
    count++;
    if (count === 1) {
      expect(JSON.parse(init?.body as string)).toEqual(fixture.wire);
      return Response.json({ ...fixture.job, data: [fixture.output] }, { status: 201 });
    }
    expect(init?.headers).toBeUndefined();
    return new Response(Uint8Array.of(1, 2));
  } }));
  const captured: unknown = items;
  expect(captured).toEqual([{ ...fixture.envelope, audio: Uint8Array.of(1, 2) }]);
  expect(count).toBe(2);
});

const auth = { lovo: { apiKey: "test-key" } };
const request = { text: "Hello", voice: "existing-speaker" };
const output = { status: "succeeded", text: "Hello", speaker: "existing-speaker", speakerStyle: "style", speed: 1, pause: [], emphasis: [], pronunciations: [], urls: ["https://audio.invalid/result.wav"] };
const job = { id: "job/1", type: "tts", status: "done", progress: 1, team: "team", createdAt: "2026-09-05T00:00:00Z", data: [output] };
const envelope = (audio: Uint8Array, output = 0, asset = 0) => ({ correlation: "ordered" as const, correlationId: `job/1:${output}:${asset}`, inputGroupId: `job/1:${output}`, audio, timestamps: [] as const });

test("LOVO dispatch sends generated native request and streams the first asset bytes before download completion", async () => {
  let finish!: () => void; const calls: string[] = [];
  const result = dispatch("lovo", { ...request, voiceStyle: "style", speed: 0.5 }, { auth, baseUrl: "https://proxy.invalid/root/?tenant=one", fetch: async (url, init) => {
    calls.push(String(url));
    if (calls.length === 1) {
      expect(String(url)).toBe("https://proxy.invalid/root/api/v1/tts/sync?tenant=one"); expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "X-API-KEY": "test-key", "content-type": "application/json" }); expect(init?.redirect).toBe("error");
      expect(JSON.parse(init?.body as string)).toEqual({ text: "Hello", speaker: "existing-speaker", speakerStyle: "style", speed: 0.5 }); return Response.json(job, { status: 201 });
    }
    expect(String(url)).toBe("https://audio.invalid/result.wav"); expect(init?.headers).toBeUndefined(); expect(init?.credentials).toBe("omit"); expect(init?.redirect).toBe("error");
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); finish = () => { controller.enqueue(Uint8Array.of(2)); controller.close(); }; } }));
  } });
  expect(await result.next()).toEqual({ done: false, value: envelope(Uint8Array.of(1)) }); finish(); expect(await Array.fromAsync(result)).toEqual([envelope(Uint8Array.of(2))]); expect(calls.length).toBe(2);
});

test.each(["sync", "async"] as const)("%s mode polls pending jobs and preserves encoded job IDs", async mode => {
  const calls: string[] = []; let polls = 0;
  expect(await Array.fromAsync(synthesize(request, { auth, mode, pollIntervalMs: 0, fetch: async (url, init) => {
    calls.push(String(url));
    if (init?.method === "POST") {
      expect(JSON.parse(init.body as string)).toEqual({ text: "Hello", speaker: "existing-speaker", speed: 1 });
      return Response.json({ ...job, status: "in_progress", callbackUrls: [], data: [] }, { status: 201 });
    }
    if (String(url).startsWith("https://api.genny.lovo.ai/")) { polls++; expect(init?.headers).toEqual({ "X-API-KEY": "test-key" }); return Response.json({ ...job, status: polls === 1 ? "in_progress" : "done", callbackUrls: [] }); }
    return new Response(Uint8Array.of(1, 2));
  } }))).toEqual([envelope(Uint8Array.of(1, 2))]);
  expect(calls).toEqual([`https://api.genny.lovo.ai/api/v1/tts${mode === "sync" ? "/sync" : ""}`, "https://api.genny.lovo.ai/api/v1/tts/job%2F1", "https://api.genny.lovo.ai/api/v1/tts/job%2F1", "https://audio.invalid/result.wav"]);
});

test("already-completed async submission is retrieved through its proper response decoder", async () => {
  let call = 0;
  expect(await Array.fromAsync(synthesize(request, { auth, mode: "async", fetch: async () => {
    call++; if (call === 1) return Response.json({ ...job, data: "untyped extra field", callbackUrls: [] }, { status: 201 });
    if (call === 2) return Response.json({ ...job, callbackUrls: [] }); return new Response(Uint8Array.of(1));
  } }))).toEqual([envelope(Uint8Array.of(1))]); expect(call).toBe(3);
});

test("multiple outputs and URLs retain file boundaries rather than implying concatenable containers", async () => {
  const urls = ["https://audio.invalid/first.wav", "https://audio.invalid/second.wav", "https://audio.invalid/third.wav"]; const calls: string[] = [];
  expect(await Array.fromAsync(synthesize(request, { auth, fetch: async (url, init) => {
    if (init?.method === "POST") return Response.json({ ...job, data: [{ ...output, urls: urls.slice(0, 2) }, { ...output, urls: urls.slice(2) }] }, { status: 201 });
    calls.push(String(url)); return new Response(Uint8Array.of(calls.length));
  } }))).toEqual([envelope(Uint8Array.of(1), 0, 0), envelope(Uint8Array.of(2), 0, 1), envelope(Uint8Array.of(3), 1, 0)]); expect(calls).toEqual(urls);
});

test.each([
  [{ ...job, data: [] }, "LOVO completed without audio outputs"],
  [{ ...job, data: [{ ...output, status: "pending" }] }, "LOVO completed without usable audio URLs"],
  [{ ...job, data: [{ ...output, urls: [] }] }, "LOVO completed without usable audio URLs"],
  [{ ...job, id: ".." }, "LOVO returned an invalid job ID"],
  [{ ...job, type: "dubbing" }, "LOVO returned a non-TTS job"],
  [{ ...job, data: [{ ...output, urls: [3] }] }, "Invalid LOVO sync-tts response"],
] as const)("rejects incomplete or invalid job %j before downloading audio", async (result, message) => {
  let calls = 0;
  await expect(Array.fromAsync(synthesize(request, { auth, fetch: async () => { calls++; return Response.json(result, { status: 201 }); } }))).rejects.toEqual(new TypeError(message)); expect(calls).toBe(1);
});

test("a changed job ID during polling fails before reading another user's output", async () => {
  let calls = 0;
  await expect(synthesize(request, { auth, pollIntervalMs: 0, fetch: async () => { calls++; return Response.json(calls === 1 ? { ...job, status: "in_progress" } : { ...job, id: "other", callbackUrls: [] }, { status: calls === 1 ? 201 : 200 }); } }).next()).rejects.toEqual(new TypeError("LOVO returned a different job ID while polling")); expect(calls).toBe(2);
});

test.each(["http://untrusted.invalid/audio", "file:///etc/passwd", "https://user:password@audio.invalid/audio", "data:audio/wav;base64,AQI="])("rejects unsafe provider URL %s before fetching", async url => {
  let calls = 0;
  await expect(synthesize(request, { auth, fetch: async () => { calls++; return Response.json({ ...job, data: [{ ...output, urls: [url] }] }, { status: 201 }); } }).next()).rejects.toEqual(new TypeError("LOVO returned an unsafe audio URL")); expect(calls).toBe(1);
});

test("job and output errors retain native code and job ID; no partial audio escapes", async () => {
  const error = { code: "synthesis_failed", message: "Voice unavailable" };
  for (const result of [{ ...job, status: "in_progress", error }, { ...job, data: [output, { ...output, status: "failed", error }] }]) {
    let calls = 0; const failure = await synthesize(request, { auth, fetch: async () => { calls++; return Response.json(result, { status: 201 }); } }).next().catch(error => error);
    expect(failure).toBeInstanceOf(LovoError); expect({ message: failure.message, statusCode: failure.statusCode, code: failure.code, jobId: failure.jobId }).toEqual({ message: "Voice unavailable", statusCode: null, code: "synthesis_failed", jobId: "job/1" }); expect(calls).toBe(1);
  }
});

test("HTTP failures retain opaque error bodies and retry timing without inventing an undocumented schema", async () => {
  const error = await synthesize(request, { auth, fetch: async () => new Response("Rate limited", { status: 429, headers: { "retry-after": "5" } }) }).next().catch(error => error);
  expect(error).toBeInstanceOf(LovoError); expect({ message: error.message, statusCode: error.statusCode, code: error.code, retryAfter: error.retryAfter }).toEqual({ message: "Rate limited", statusCode: 429, code: null, retryAfter: "5" });
});

test("abort while polling wakes immediately and never cancels or resubmits the remote job", async () => {
  const controller = new AbortController(); let polled!: () => void; const started = new Promise<void>(resolve => { polled = resolve; }); let calls = 0;
  const pending = synthesize(request, { auth, signal: controller.signal, pollIntervalMs: 60000, fetch: async () => { calls++; polled(); return Response.json({ ...job, status: "in_progress" }, { status: 201 }); } }).next();
  await started; controller.abort(new Error("stop")); await expect(pending).rejects.toEqual(new Error("stop")); expect(calls).toBe(1);
});

test("consumer return cancels the current file reader without downloading later assets", async () => {
  let calls = 0; let cancelled = false;
  const result = synthesize(request, { auth, fetch: async () => {
    calls++; if (calls === 1) return Response.json({ ...job, data: [{ ...output, urls: ["https://audio.invalid/a", "https://audio.invalid/b"] }] }, { status: 201 });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); }, cancel() { cancelled = true; return new Promise(() => {}); } }));
  } });
  expect(await result.next()).toEqual({ done: false, value: envelope(Uint8Array.of(1)) }); await result.return!(); expect(cancelled).toBe(true); expect(calls).toBe(2);
});

test("deadline covers a fetch ignoring abort and releases its late response", async () => {
  let respond!: (response: Response) => void; let cancelled = false;
  await expect(synthesize(request, { auth, timeoutMs: 5, fetch: () => new Promise(resolve => { respond = resolve; }) }).next()).rejects.toEqual(new DOMException("LOVO synthesis deadline expired", "TimeoutError"));
  respond(new Response(new ReadableStream({ cancel() { cancelled = true; } }))); await Promise.resolve(); expect(cancelled).toBe(true);
});

test.each(["metadata", "error", "audio"] as const)("deadline releases a stalled %s response body", async kind => {
  let calls = 0; let cancelled = false;
  await expect(synthesize(request, { auth, timeoutMs: 5, fetch: async () => {
    calls++; if (kind === "audio" && calls === 1) return Response.json(job, { status: 201 });
    return new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }), { status: kind === "error" ? 400 : kind === "metadata" ? 201 : 200 });
  } }).next()).rejects.toEqual(new DOMException("LOVO synthesis deadline expired", "TimeoutError")); expect(cancelled).toBe(true);
});

test("request validation runs before authentication, network or input iteration", async () => {
  let acquired = false;
  const invalid = { ...request, text: { [Symbol.asyncIterator]() { acquired = true; throw new Error("input must not run"); } } };
  // @ts-expect-error LOVO has no text input streaming protocol.
  await expect(synthesize(invalid).next()).rejects.toEqual(new TypeError("Invalid lovo TTS request")); expect(acquired).toBe(false);
  await expect(synthesize(request, { auth, pollIntervalMs: -1 }).next()).rejects.toEqual(new TypeError("LOVO polling interval and timeout must be integers between 0 and 2147483647"));
});
