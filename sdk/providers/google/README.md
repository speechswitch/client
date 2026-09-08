# Google Cloud Text-to-Speech

One `synthesize` operation yields audio bytes. Complete, cataloged Google
Discovery and protobuf contracts drive specialized wire code generation; model
capabilities are authored separately in the runtime-free provider schema.

```ts
import { synthesize } from "../../index.ts";

for await (const audio of synthesize("google", {
  model: "gemini-2.5-flash-tts",
  voice: "Kore",
  language: "en-US",
  instructions: "Speak warmly and naturally.",
  text: "Hello!", // Also accepts AsyncIterable<string> for streaming formats.
  output: { format: "pcm", sampleRateHz: 24000 },
}, { auth: { google: { accessToken: "...", quotaProject: "your-project" } } })) {
  // Consume signed 16-bit little-endian PCM as it arrives.
}
```

## Models and input

`model` is the discriminator; do not supply a vendor-shaped request. The current
Cloud TTS model ID is `gemini-2.5-flash-lite-preview-tts`, not the issue catalog's
`gemini-2.5-flash-lite-tts`. Flash Lite is single-speaker. Gemini 2.5 Flash/Pro
and 3.1 Flash preview additionally support exactly two distinct speaker aliases:

```ts
const request = {
  model: "gemini-2.5-pro-tts",
  language: "en-US",
  speakers: [{ alias: "Sam", voice: "Kore" }, { alias: "Bob", voice: "Puck" }],
  turns: [{ speaker: "Sam", text: "Hi!" }, { speaker: "Bob", text: "Hello!" }],
  output: { format: "wav" },
} as const;
```

Use either `turns` or `text: "Sam: Hi!\nBob: Hello!"`, without top-level `voice`.
Streaming `turns` accepts `AsyncIterable<{ speaker: string; text: string }>`;
the generated item check runs when each turn is consumed. The playground accepts
complete turn arrays; its delayed-segment editor remains for streaming text.
Gemini `instructions` maps to the native prompt, sent only with the first streamed
input. `textNormalization` and category-specific `safetySettings` are independent.

`chirp-3-hd` requires a prebuilt voice name such as `Kore`, plus `language`. The
adapter constructs `en-US-Chirp3-HD-Kore`; it never sends a fictitious model name.
`inputType: "ssml"` is HTTP-only; `"markup"` supports native pause tags over both
transports. `replacements: [{ pattern, replacement, alphabet: "ipa" }]` maps to
Google custom pronunciations. Locale-specific markup/pronunciation exclusions
are encoded in the provider union, not duplicated as handwritten checks.

`chirp-3-instant-custom-voice` uses an **existing voice cloning key** as `voice`,
through the documented v1beta1 REST/gRPC endpoints. Creating a key, consent
recordings, and voice training are separate operations, not synthesized input.
Its documented locale/output subset differs from prebuilt Chirp. In particular,
this integration does not infer output MP3/M4A support from the reference-audio
upload formats listed elsewhere in that guide.

## Output and streaming

| Normalized output | Transport | Representation |
| --- | --- | --- |
| `pcm`, `ogg_opus` | Native gRPC by default | Headerless s16le / Ogg Opus |
| `alaw`, `mulaw` | Native gRPC | Headerless G.711 |
| `wav` | REST | LINEAR16; optional `sampleEncoding: "alaw"` or `"mulaw"` remains WAV-wrapped |
| `mp3` | REST, prebuilt Chirp/Gemini | Fixed 32000 bps |

All output is an audio iterator. REST returns one base64 JSON payload, explicitly
decoded at the wire boundary; it cannot emit incremental audio before the JSON
response is available. `sampleRateHz` is independent of container/encoding;
omission lets Google use the voice's natural rate. Speed defaults to 1.

Complete text with an explicit HTTP-only gain, pitch or effects profile uses REST
even for PCM/Opus. Incremental input excludes those controls and SSML by type.
Pitch is exposed for Gemini, not Chirp. No unsupported timestamps, clear/flush
commands, or acknowledgement events are fabricated. For barge-in, abort the
operation, clear local playback, and begin another request. Consumer exit,
protocol errors, abort, and deadlines close the transport without waiting for a
stalled text iterator or its `return()`.

## Authentication and runtimes

Public `auth.google` fields resolve before transport creation:

| Field | Environment fallback, in order |
| --- | --- |
| `accessToken` | `SPEECHSWITCH_GOOGLE_ACCESS_TOKEN`, `GOOGLE_OAUTH_ACCESS_TOKEN` |
| `apiKey` | `SPEECHSWITCH_GOOGLE_API_KEY`, `GOOGLE_API_KEY` |
| `quotaProject` | `SPEECHSWITCH_GOOGLE_QUOTA_PROJECT`, `GOOGLE_CLOUD_QUOTA_PROJECT` |

Supply a Cloud TTS credential, not a Gemini Developer API key. A fresh OAuth
access token with a quota project follows Google's Cloud TTS authentication
guide. The adapter does not implement ADC discovery, token refresh, or interpret
`GOOGLE_APPLICATION_CREDENTIALS` as a token. Applications manage credential
refresh outside the operation. The Discovery contract also exposes an API key;
the adapter forwards it in `x-goog-api-key`. OAuth uses `authorization`, and quota
uses `x-goog-user-project`; credentials never enter URLs.

Native streaming uses Node/Bun HTTP/2, loaded lazily. Browser applications need an
injected `grpc: GrpcConnect` transport or a backend; REST uses injected/global
`fetch`. Never embed server credentials in a public browser bundle. `baseUrl`
and `grpcUrl` independently select endpoints/proxies (including regional origins),
with the generated operation path appended. `signal` and whole-operation
`timeoutMs` cover transport opening, producer waits, writes, and output waits.

Tests exercise exact HTTP/protobuf payloads, real Node HTTP/2 framing/auth,
pre-completion audio, deadlines, iterator cleanup, generated guards, type
narrowing, and model-aware playground forms. No paid live synthesis was performed.
The unchanged sources and content hashes are cataloged in `schemas/sources.yaml`.
