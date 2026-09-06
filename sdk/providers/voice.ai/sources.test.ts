import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";

const root = new URL("../../../", import.meta.url);
function embedded(name: string) {
  const text = readFileSync(new URL(`schemas/sources/voice.ai/${name}`, root), "utf8");
  const blocks = [...text.matchAll(/^````yaml[^\n]*\n([\s\S]*?)^````/gm)];
  expect(blocks.length).toBe(1);
  return parse(blocks[0]![1]!);
}

test("Voice.ai records all unchanged snapshots and exact acquisition URLs", () => {
  const sources = (parse(readFileSync(new URL("schemas/sources.yaml", root), "utf8")).sources as { provider: string; name: string; path: string; url: string; method: string; body?: string; sha256: string }[]).filter(source => source.provider === "voice.ai");
  expect(sources.map(source => source.name).sort()).toEqual(readdirSync(new URL("schemas/sources/voice.ai/", root)).sort());
  expect(sources.map(source => source.url)).toEqual([
    "https://voice.ai/docs/openapi.json", "https://voice.ai/llms.txt",
    "https://voice.ai/docs/api-reference/text-to-speech/generate-speech.md",
    "https://voice.ai/docs/guides/text-to-speech/streaming.md",
    "https://voice.ai/docs/api-reference/text-to-speech/single-context-websocket.md",
    "https://voice.ai/docs/api-reference/text-to-speech/multi-context-websocket.md",
    "https://voice.ai/docs/api-reference/text-to-speech/speech-stream.md",
    "https://voice.ai/docs/guides/authentication.md",
    "https://voice.ai/docs/guides/text-to-speech/quickstart.md",
  ]);
  for (const source of sources) {
    expect([source.method, source.body]).toEqual(["GET", undefined]);
    expect(createHash("sha256").update(readFileSync(new URL(source.path, root))).digest("hex")).toBe(source.sha256);
  }
});

test("legacy OpenAPI lacks response/auth schemas and differs from current HTTP", () => {
  const legacy = JSON.parse(readFileSync(new URL("schemas/sources/voice.ai/00-openapi.json", root), "utf8"));
  expect([legacy.openapi, legacy.info.version]).toEqual(["3.1.0", "1.4.0"]);
  expect(legacy.paths["/tts/v2/audio/speech"].post.responses[200]).toEqual({ description: "Output mp3, wav, or pcm file" });
  expect([legacy.security, legacy.components.securitySchemes]).toEqual([undefined, undefined]);
  const request = legacy.components.schemas.TextToSpeechGenerateRequest;
  expect(request.required).toEqual(["text", "voice", "audio_format", "streaming"]);
  expect([request.properties.model, request.properties.audio_format.enum, request.properties.temperature.minimum]).toEqual([undefined, undefined, undefined]);
  const current = embedded("02-generate.md");
  expect([current.info.version, current.servers[0].url]).toEqual(["1.5.0", "https://dev.voice.ai"]);
  const properties = current.components.schemas.GenerateSpeechRequest.properties;
  expect(properties.model.enum).toEqual(["voiceai-tts-v1-latest", "voiceai-tts-v1-2026-02-10", "voiceai-tts-multilingual-v1-latest", "voiceai-tts-multilingual-v1-2026-02-10"]);
  expect([properties.temperature.minimum, properties.temperature.maximum, properties.top_p.minimum, properties.top_p.maximum]).toEqual([0, 2, 0, 1]);
  expect(current.components.schemas.GenerateSpeechRequest.required).toEqual(["text"]);
  expect(Object.keys(embedded("06-http-stream.md").paths)).toEqual(["/api/v1/tts/speech/stream"]);
});

test("captured structured WebSocket messages distinguish completion, closure and errors", () => {
  const channel = embedded("05-multi-websocket.md");
  expect([channel.address, channel.servers[0].protocol, channel.servers[0].host]).toEqual(["/api/v1/tts/multi-stream", "wss", "dev.voice.ai"]);
  expect(channel.operations.map((operation: any) => operation.id)).toEqual(["sendInitMulti", "sendTextMulti", "receiveAudioMulti", "closeContextMulti", "closeSocketMulti"]);
  const messages = Object.fromEntries(channel.operations.flatMap((operation: any) => operation.messages.map((message: any) => [message.id, message.jsonPayloadSchema])));
  expect(messages.initMessage.required).toEqual(["text"]);
  expect(messages.initMessage.properties.model.enum).toEqual(["voiceai-tts-v1-latest", "voiceai-tts-v1-2026-02-10", "voiceai-tts-lite-v1-latest", "voiceai-tts-lite-v1-2026-04-15", "voiceai-tts-multilingual-v1-latest", "voiceai-tts-multilingual-v1-2026-02-10"]);
  expect(messages.initMessage.properties.delivery_mode.enum).toEqual(["raw", "paced"]);
  expect(Object.keys(messages.textMessage.properties)).toEqual(["context_id", "text", "flush", "close_context", "close_socket", "auto_close"]);
  expect(messages.audioChunk.required).toEqual(["audio", "context_id"]);
  expect(messages.completionMessage.required).toEqual(["is_last", "context_id"]);
  expect(messages.contextClosedMessage.required).toEqual(["context_closed", "context_id"]);
  expect([messages.completionMessage.properties.is_last.const, messages.contextClosedMessage.properties.context_closed.const]).toEqual([true, true]);
  expect(messages.errorMessage.required).toEqual(["error"]);
  expect(embedded("04-single-websocket.md").address).toBe("/api/v1/tts/stream");
});
