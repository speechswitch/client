# OpenAI speech

One `synthesize("openai", request, options)` operation streams audio from
`POST /audio/speech`. The provider's plain TypeScript request union controls model
capabilities; the shared base stays free of request variants.

```ts
import { synthesize } from "../../dispatch.ts";

for await (const item of synthesize("openai", {
  model: "gpt-4o-mini-tts",
  text: "Hello!",
  voice: "cedar",
  instructions: "Speak quietly.",
  output: { format: "wav" },
})) {
  if (item instanceof Uint8Array) {
    // Consume each audio chunk; buffering is a consumer decision.
  }
}
```

`tts-1` remains the default; `tts-1-hd` is also supported. These models expose nine
catalog voices and cannot request instructions or SSE usage. The mini-TTS alias
and its documented March 20 / December 15, 2025 snapshots additionally expose
13 catalog voices, acting instructions and explicit existing custom-voice IDs.
Use `voiceSource: "custom"` with `voice: "your-saved-id"`; IDs are not inferred
from their spelling. Voice creation and consent management are separate APIs,
and custom voice access requires an eligible account.

The canonical schema enforces the contract's 4096-code-point limit on text and
instructions. Mini-TTS also has a 2000-input-token limit enforced by the service;
we do not approximate token counts with character counts.

PCM is the SDK default: 24 kHz, signed 16-bit little-endian mono. MP3, WAV, FLAC,
AAC and Opus are available, without invented resampling or bitrate parameters.
Opus is not relabeled as Ogg when its framing is unspecified. Choose WAV/MP3 for
the playground's browser player. Language follows the supplied text, with no
unsupported language parameter. Speed preserves the native 0.25–4 multiplier.

## Streaming and cancellation

Binary streaming yields `Uint8Array` chunks followed by `{ event: "done" }`, with
the response's `requestId` when supplied. `includeUsage: true` selects the mini
models' SSE response mode: native base64 deltas become bytes, and completion
includes `{ inputTokens, outputTokens, totalTokens }` usage. Missing completion
and malformed events fail instead of fabricating success.

Text input is whole-request only. This endpoint supplies no timestamps or native
clear/flush protocol. Use `signal`, `timeoutMs`, or return from the iterator to
cancel transport consumption; consumers must separately stop queued playback.
Cancellation does not promise that the server stops billing or generation.

## Configuration and source quality

API keys resolve from shared `auth.openai.apiKey`, then
`SPEECHSWITCH_OPENAI_API_KEY`, then `OPENAI_API_KEY`. `fetch` is injectable.
`baseUrl` is the API root **including `/v1`**, defaulting to
`https://api.openai.com/v1`. Redirects are rejected. `OpenaiError` retains status,
opaque body, request ID and Retry-After; the adapter does not automatically retry.
Keep credentials on a trusted server, not in a public browser bundle.

Unlike partial provider definitions, the selected speech graph in the official
SDK OpenAPI input defines the request, binary/SSE modes and all referenced SSE
events. The generator compiles that graph into direct fetch/validation code;
unsupported semantics fail generation. Model-specific restrictions come from
the canonical provider union, cross-checked against the guide. Four unchanged
upstream snapshots and their SHA-256 hashes are cataloged in `schemas/sources.yaml`.

Official sources: [Speech reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create),
[guide](https://developers.openai.com/api/docs/guides/text-to-speech),
[mini model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts).
Applications must disclose that the voice is AI-generated.

Rust/Python/Go request types are generated from these same TypeScript schemas,
including the legacy/mini/custom alternatives. They remain type packages, not
native synthesis clients or executable request validators. Checks use mock HTTP,
native Node loopback streaming, schema mutations and real language compilers;
no paid synthesis call is claimed.
