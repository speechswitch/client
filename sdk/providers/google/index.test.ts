import { expect, expectTypeOf, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import protobuf from "protobufjs";
import { synthesize, GoogleError, type TtsRequest } from "./index.ts";
import { synthesize as dispatch } from "../../dispatch.ts";
import type { GrpcConnect, GrpcOptions } from "../../runtime/grpc.ts";
import { GrpcError } from "../../runtime/grpc.ts";

const root = new protobuf.Root();
const source = new URL("../../../schemas/sources/google/", import.meta.url);
for (const file of ["02-cloud-tts-v1.proto", "03-cloud-tts-v1beta1.proto", ...readdirSync(new URL("imports/", source), { recursive: true }).filter((name): name is string => typeof name === "string" && name.endsWith(".proto")).map(name => `imports/${name}`)]) {
  protobuf.parse(readFileSync(new URL(file, source), "utf8"), root);
}
root.resolveAll();
const requestMessage = root.lookupType("google.cloud.texttospeech.v1.StreamingSynthesizeRequest");
const auth = { google: { apiKey: "test-key" } };
const common = { model: "gemini-2.5-flash-tts", voice: "Kore", language: "en-US", text: "hello", output: { format: "wav" } } as const;
const speakers = [{ alias: "Sam", voice: "Kore" }, { alias: "Bob", voice: "Puck" }] as const;
const ok = () => Response.json({ audioContent: "AQID" });
async function* input(...values: string[]) { yield* values; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

class Transport {
  readonly sent: Record<string, any>[] = [];
  options: GrpcOptions | undefined;
  ended = 0; closed = 0;
  readonly queue: (Uint8Array | Error | null)[] = [];
  changed = deferred<void>();
  onWrite: (message: Record<string, any>) => Promise<void> = async () => {};
  readonly connect: GrpcConnect = async options => {
    this.options = options;
    const transport = this;
    return {
      async write(bytes) {
        const message = requestMessage.toObject(requestMessage.decode(bytes), { enums: String });
        transport.sent.push(message); await transport.onWrite(message);
      },
      end() { transport.ended++; transport.push(null); },
      close() { transport.closed++; transport.push(null); },
      responses: { async *[Symbol.asyncIterator]() {
        for (;;) {
          if (!transport.queue.length) await transport.changed.promise;
          const value = transport.queue.shift();
          if (value === null) return;
          if (value instanceof Error) throw value;
          if (value) yield value;
        }
      } },
    };
  };
  push(value: Uint8Array | Error | null) { this.queue.push(value); const changed = this.changed; this.changed = deferred<void>(); changed.resolve(); }
  audio(...bytes: number[]) { this.push(Uint8Array.of(10, bytes.length, ...bytes)); }
}

test("REST maps Gemini controls, preserves false/zero, and authenticates in headers", async () => {
  const result = await Array.fromAsync(synthesize({ ...common, instructions: "Warmly", textNormalization: false,
    speed: 0.5, volumeDb: 0, pitchSemitones: 0, effectsProfiles: ["headphone-class-device"],
    safetySettings: [{ category: "harassment", threshold: "high" }], output: { format: "wav", sampleRateHz: 24000 },
  }, { auth: { google: { apiKey: "key", accessToken: "token", quotaProject: "project" } }, baseUrl: "https://proxy.invalid/google/?tenant=one", fetch: async (url, init) => {
    expect(String(url)).toBe("https://proxy.invalid/google/v1/text:synthesize?tenant=one");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "x-goog-api-key": "key", authorization: "Bearer token", "x-goog-user-project": "project", "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({
      input: { text: "hello", prompt: "Warmly" }, voice: { languageCode: "en-US", modelName: "gemini-2.5-flash-tts", name: "Kore" },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000, speakingRate: 0.5, volumeGainDb: 0, pitch: 0, effectsProfileId: ["headphone-class-device"] },
      advancedVoiceOptions: { enableTextnorm: false, safetySettings: { settings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" }] } },
    }); return ok();
  } }));
  expect(result).toEqual([Uint8Array.of(1, 2, 3)]);
});

test.each([
  ["gemini-2.5-flash-lite-preview-tts"], ["gemini-2.5-flash-tts"], ["gemini-2.5-pro-tts"], ["gemini-3.1-flash-tts-preview"],
] as const)("passes the actual %s model ID", async model => {
  await Array.fromAsync(synthesize({ ...common, model }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(init?.body as string).voice).toEqual({ languageCode: "en-US", name: "Kore", modelName: model }); return ok();
  } }));
});

test("Chirp SSML uses a locale-qualified voice without a fictitious modelName", async () => {
  await Array.fromAsync(synthesize({ model: "chirp-3-hd", voice: "Kore", language: "en-US", inputType: "ssml", text: "<speak>Hello</speak>",
    replacements: [{ pattern: "Acme", replacement: "ækmi", alphabet: "ipa" }], output: { format: "pcm" },
  }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(init?.body as string)).toEqual({
      input: { ssml: "<speak>Hello</speak>", customPronunciations: { pronunciations: [{ phrase: "Acme", pronunciation: "ækmi", phoneticEncoding: "PHONETIC_ENCODING_IPA" }] } },
      voice: { languageCode: "en-US", name: "en-US-Chirp3-HD-Kore" }, audioConfig: { audioEncoding: "PCM", speakingRate: 1 },
    }); return ok();
  } }));
});

test.each(["es-419", "cmn-tw"])("Gemini accepts the documented %s locale without imposing country-code casing", async language => {
  await Array.fromAsync(synthesize({ ...common, language }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(init?.body as string).voice.languageCode).toBe(language); return ok();
  } }));
});

test.each([
  { output: { format: "wav" }, encoding: "LINEAR16" },
  { output: { format: "wav", sampleEncoding: "mulaw" }, encoding: "MULAW" },
  { output: { format: "wav", sampleEncoding: "alaw" }, encoding: "ALAW" },
  { output: { format: "mp3", bitRateBps: 32000 }, encoding: "MP3" },
] as const)("preserves the HTTP container for $encoding", async ({ output, encoding }) => {
  await Array.fromAsync(synthesize({ ...common, output }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(init?.body as string).audioConfig).toEqual({ audioEncoding: encoding, speakingRate: 1 }); return ok();
  } }));
});

test.each([
  { format: "pcm", encoding: "PCM" }, { format: "ogg_opus", encoding: "OGG_OPUS" },
  { format: "alaw", encoding: "ALAW" }, { format: "mulaw", encoding: "MULAW" },
] as const)("static $format uses byte-native streaming", async ({ format, encoding }) => {
  const transport = new Transport();
  transport.onWrite = async message => { if (message.input) transport.audio(4, 5); };
  expect(await Array.fromAsync(synthesize({ ...common, output: { format } }, { auth, grpc: transport.connect, grpcUrl: "https://proxy.invalid/google/?tenant=one" }))).toEqual([Uint8Array.of(4, 5)]);
  expect(transport.options?.url).toBe("https://proxy.invalid/google/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize?tenant=one");
  expect(transport.options?.headers).toEqual({ "x-goog-api-key": "test-key" });
  expect(transport.sent).toEqual([
    { streamingConfig: { voice: { languageCode: "en-US", name: "Kore", modelName: "gemini-2.5-flash-tts" }, streamingAudioConfig: { audioEncoding: encoding, speakingRate: 1 }, advancedVoiceOptions: { enableTextnorm: true } } },
    { input: { text: "hello" } },
  ]);
  expect([transport.ended, transport.closed]).toEqual([1, 1]);
});

test("audio arrives while input remains open; only the first input includes instructions", async () => {
  const transport = new Transport(); const resume = deferred<void>();
  const text = (async function* () { yield "one"; await resume.promise; yield "two"; })();
  transport.onWrite = async message => { if (message.input) transport.audio(message.input.text === "one" ? 1 : 2); };
  const result = synthesize({ ...common, text, instructions: "Cheerful", output: { format: "pcm" } }, { auth, grpc: transport.connect });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  expect(transport.ended).toBe(0);
  resume.resolve();
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(2) });
  expect(await result.next()).toEqual({ done: true, value: undefined });
  expect(transport.sent.slice(1)).toEqual([{ input: { text: "one", prompt: "Cheerful" } }, { input: { text: "two" } }]);
});

test("output is not held behind request-write backpressure", async () => {
  const transport = new Transport(); const written = deferred<void>();
  transport.onWrite = async message => { if (message.input) { transport.audio(1); await written.promise; } };
  const result = synthesize({ ...common, output: { format: "pcm" } }, { auth, grpc: transport.connect });
  expect(await result.next()).toEqual({ done: false, value: Uint8Array.of(1) });
  written.resolve(); expect(await result.next()).toEqual({ done: true, value: undefined });
});

test("dialogue is available as aliased text and structured HTTP or streaming turns", async () => {
  const turns = [{ speaker: "Sam", text: "Hi" }, { speaker: "Bob", text: "Hello" }];
  for (const content of [{ text: "Sam: Hi\nBob: Hello" }, { text: undefined, turns }]) {
    await Array.fromAsync(synthesize({ ...common, voice: undefined, speakers, ...content }, { auth, fetch: async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.voice).toEqual({ languageCode: "en-US", modelName: "gemini-2.5-flash-tts", multiSpeakerVoiceConfig: { speakerVoiceConfigs: [{ speakerAlias: "Sam", speakerId: "Kore" }, { speakerAlias: "Bob", speakerId: "Puck" }] } });
      expect(body.input).toEqual(content.turns ? { multiSpeakerMarkup: { turns } } : content);
      return ok();
    } }));
  }
  const transport = new Transport();
  await Array.fromAsync(synthesize({ ...common, voice: undefined, text: undefined, speakers, turns: (async function* () { yield* turns; })(), instructions: "Conversational", output: { format: "pcm" } }, { auth, grpc: transport.connect }));
  expect(transport.sent.slice(1)).toEqual([
    { input: { multiSpeakerMarkup: { turns: [turns[0]] }, prompt: "Conversational" } },
    { input: { multiSpeakerMarkup: { turns: [turns[1]] } } },
  ]);
});

test("existing custom voices use the documented beta endpoints, without a model or prebuilt name", async () => {
  const request = { model: "chirp-3-instant-custom-voice", language: "en-US", voice: "existing-cloning-key", text: "hello", inputType: "markup" } as const;
  await Array.fromAsync(synthesize({ ...request, output: { format: "wav" } }, { auth, fetch: async (url, init) => {
    expect(String(url)).toBe("https://texttospeech.googleapis.com/v1beta1/text:synthesize");
    expect(JSON.parse(init?.body as string)).toEqual({ input: { markup: "hello" }, voice: { languageCode: "en-US", voiceClone: { voiceCloningKey: "existing-cloning-key" } }, audioConfig: { audioEncoding: "LINEAR16", speakingRate: 1 } }); return ok();
  } }));
  const transport = new Transport();
  await Array.fromAsync(synthesize({ ...request, text: input("hello"), output: { format: "pcm" }, speed: 1.5,
    replacements: [{ pattern: "Acme", replacement: "akmi", alphabet: "x_sampa" as const }],
  }, { auth, grpc: transport.connect }));
  expect(transport.options?.url).toBe("https://texttospeech.googleapis.com/google.cloud.texttospeech.v1beta1.TextToSpeech/StreamingSynthesize");
  expect(transport.sent).toEqual([
    { streamingConfig: { voice: { languageCode: "en-US", voiceClone: { voiceCloningKey: "existing-cloning-key" } }, streamingAudioConfig: { audioEncoding: "PCM", speakingRate: 1.5 }, customPronunciations: { pronunciations: [{ phrase: "Acme", pronunciation: "akmi", phoneticEncoding: "PHONETIC_ENCODING_X_SAMPA" }] } } },
    { input: { markup: "hello" } },
  ]);
});

test("static PCM with an explicit HTTP-only control uses REST", async () => {
  await Array.fromAsync(synthesize({ ...common, output: { format: "pcm" }, volumeDb: 0 }, { auth, fetch: async (_url, init) => {
    expect(JSON.parse(init?.body as string).audioConfig).toEqual({ audioEncoding: "PCM", speakingRate: 1, volumeGainDb: 0 }); return ok();
  } }));
});

test("generated guards reject model, language, format, and item combinations before network I/O", async () => {
  const chirp = { ...common, model: "chirp-3-hd" };
  const replacement = [{ pattern: "Acme", replacement: "akmi", alphabet: "ipa" }];
  const values = [
    { ...common, model: "gemini-2.5-flash-lite-tts" },
    { ...common, model: "gemini-2.5-flash-lite-preview-tts", voice: undefined, speakers },
    { ...common, voice: undefined }, { ...common, inputType: "ssml" },
    { ...chirp, instructions: "Warmly" }, { ...chirp, textNormalization: true }, { ...chirp, pitchSemitones: 1 },
    { ...chirp, language: "bg-BG", inputType: "markup" }, { ...chirp, language: "bn-IN", replacements: replacement },
    { ...chirp, replacements: [{ pattern: "Acme", replacement: "akmi" }] },
    { ...common, text: input("hello") }, { ...common, text: input("hello"), output: { format: "pcm" }, volumeDb: 0 },
    { ...common, output: { format: "mulaw" }, effectsProfiles: [] },
    { ...common, output: { format: "pcm", byteOrder: "big_endian" } },
    { ...common, output: { format: "mp3", bitRateBps: 128000 } },
    { ...common, output: { format: "wav", sampleRateHz: NaN } },
    { ...common, speed: 2.1 }, { ...common, safetySettings: [{ category: "unknown", threshold: "low" }] },
    { ...common, turns: [{ speaker: "Sam", text: "Hi" }] },
  ];
  let calls = 0;
  for (const value of values) await expect(Array.fromAsync(synthesize(value as TtsRequest, { auth, fetch: async () => { calls++; return ok(); }, grpc: async () => { calls++; throw new Error("unexpected network"); } }))).rejects.toEqual(new TypeError("Invalid google TTS request"));
  expect(calls).toBe(0);
});

test("turn references and byte limits are checked, including non-ASCII text", async () => {
  for (const [request, error] of [
    [{ ...common, text: "😀".repeat(1001) }, "Google input exceeds 4000 UTF-8 bytes"],
    [{ ...common, instructions: "😀".repeat(1001) }, "Google input exceeds 4000 UTF-8 bytes"],
    [{ ...common, output: { format: "wav", sampleRateHz: 24000.5 } }, "Google sampleRateHz must be a safe integer"],
    [{ ...common, voice: undefined, speakers: [speakers[0]] }, "Google dialogue requires exactly two distinct speaker aliases"],
    [{ ...common, voice: undefined, speakers: [speakers[0], speakers[0]] }, "Google dialogue requires exactly two distinct speaker aliases"],
    [{ ...common, voice: undefined, text: undefined, speakers, turns: [] }, "Google dialogue turns must not be empty"],
    [{ ...common, voice: undefined, text: undefined, speakers, turns: [{ speaker: "Alice", text: "Hi" }] }, "Google dialogue references an unknown speaker: Alice"],
  ] as const) await expect(Array.fromAsync(synthesize(request as TtsRequest, { auth }))).rejects.toEqual(new TypeError(error));
  await Array.fromAsync(synthesize({ ...common, text: "😀".repeat(1000), instructions: "😀".repeat(1000) }, { auth, fetch: async () => ok() }));
});

test("bad async input is validated at consumption and closes the transport", async () => {
  for (const text of [undefined, { command: "clear" }, { command: "flush" }, { command: "update", replacements: [] }]) {
    const transport = new Transport();
    const request = { ...common, text: (async function* () { yield text; })(), output: { format: "pcm" } } as unknown as TtsRequest;
    await expect(Array.fromAsync(synthesize(request, { auth, grpc: transport.connect }))).rejects.toEqual(new TypeError("Invalid google TTS input item"));
    expect(transport.closed).toBe(1); expect(transport.sent.length).toBe(1);
  }
  const transport = new Transport();
  const request = { ...common, text: undefined, voice: undefined, speakers, turns: (async function* () { yield { speaker: "Sam", text: undefined }; })(), output: { format: "pcm" } } as unknown as TtsRequest;
  await expect(Array.fromAsync(synthesize(request, { auth, grpc: transport.connect }))).rejects.toEqual(new TypeError("Invalid google TTS input item"));
});

test("abort cancels a stalled input iterator without awaiting return", async () => {
  const transport = new Transport(); const acquired = deferred<void>(); let returned = 0;
  const text = { [Symbol.asyncIterator]() { return { next() { acquired.resolve(); return new Promise<IteratorResult<string>>(() => {}); }, return() { returned++; return new Promise<IteratorResult<string>>(() => {}); } }; } };
  const controller = new AbortController(); const reason = new Error("cancelled");
  const pending = synthesize({ ...common, text, output: { format: "pcm" } }, { auth, grpc: transport.connect, signal: controller.signal }).next();
  await acquired.promise; controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect([transport.closed, returned]).toEqual([1, 1]);
});

test("consumer return closes the stream and its input producer", async () => {
  const transport = new Transport(); let returned = false;
  const text = { [Symbol.asyncIterator]() { let first = true; return { async next() {
    if (first) { first = false; return { done: false as const, value: "hello" }; }
    return new Promise<IteratorResult<string>>(() => {});
  }, async return() { returned = true; return { done: true as const, value: undefined }; } }; } };
  transport.onWrite = async message => { if (message.input) transport.audio(1); };
  const stream = synthesize({ ...common, text, output: { format: "pcm" } }, { auth, grpc: transport.connect });
  await stream.next(); await stream.return?.();
  expect([transport.closed, returned]).toEqual([1, true]);
});

test("deadlines cover a transport opening, stalled writes, and injected HTTP", async () => {
  const opening = deferred<Awaited<ReturnType<GrpcConnect>>>(); let closed = 0;
  await expect(synthesize({ ...common, output: { format: "pcm" } }, { auth, timeoutMs: 10, grpc: () => opening.promise }).next()).rejects.toEqual(new DOMException("Google synthesis deadline expired", "TimeoutError"));
  opening.resolve({ responses: input() as unknown as AsyncIterable<Uint8Array>, write: async () => {}, end() {}, close() { closed++; } });
  await Promise.resolve(); expect(closed).toBe(1);
  const transport = new Transport(); transport.onWrite = () => new Promise(() => {});
  await expect(synthesize({ ...common, output: { format: "pcm" } }, { auth, timeoutMs: 10, grpc: transport.connect }).next()).rejects.toEqual(new DOMException("Google synthesis deadline expired", "TimeoutError"));
  expect(transport.closed).toBe(1);
  await expect(synthesize(common, { auth, timeoutMs: 10, fetch: () => new Promise(() => {}) }).next()).rejects.toEqual(new DOMException("Google synthesis deadline expired", "TimeoutError"));
});

test("HTTP and streaming failures retain their exact error identity", async () => {
  await expect(synthesize(common, { auth, fetch: async () => Response.json({ error: { message: "Denied" } }, { status: 403 }) }).next()).rejects.toEqual(new GoogleError(403, "Denied"));
  await expect(synthesize(common, { auth, fetch: async () => Response.json({ audioContent: 123 }) }).next()).rejects.toEqual(new TypeError("Google returned an invalid synthesis response"));
  const transport = new Transport(); const failure = new GrpcError(16, "Denied");
  transport.onWrite = async () => { transport.push(failure); };
  await expect(synthesize({ ...common, text: input("hello"), output: { format: "pcm" } }, { auth, grpc: transport.connect }).next()).rejects.toBe(failure);
});

test("public dispatch infers Google capabilities without widening Amazon", () => {
  const stream = dispatch("google", common, { auth });
  expectTypeOf(stream).toEqualTypeOf<AsyncIterableIterator<Uint8Array>>();
  dispatch("google", { ...common, text: input("hello"), output: { format: "pcm" } }, { auth });
  dispatch("google", { ...common, text: undefined, voice: undefined, speakers, turns: (async function* () { yield { speaker: "Sam", text: "Hi" }; })(), output: { format: "pcm" } }, { auth });
  // @ts-expect-error Flash Lite cannot synthesize dialogue.
  dispatch("google", { ...common, model: "gemini-2.5-flash-lite-preview-tts", voice: undefined, speakers });
  // @ts-expect-error WAV cannot accept streaming text.
  dispatch("google", { ...common, text: input("hello") });
  // @ts-expect-error Chirp does not accept Gemini instructions.
  dispatch("google", { ...common, model: "chirp-3-hd", instructions: "Happy" });
  // @ts-expect-error Unsupported locale/markup combination.
  dispatch("google", { ...common, model: "chirp-3-hd", language: "bg-BG", inputType: "markup" });
  // @ts-expect-error Audio commands are not Google input items.
  dispatch("google", { ...common, text: (async function* () { yield { command: "clear" as const }; })(), output: { format: "pcm" } });
  // @ts-expect-error Other integrations retain their narrower input types.
  dispatch("amazon", { model: "generative", voice: "Amy", text: (async function* () { yield { command: "clear" as const }; })(), output: { format: "pcm" } });
});
