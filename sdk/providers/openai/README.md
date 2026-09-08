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

Rust/Python/Go request types and runtime validators are generated from these same
TypeScript schemas, including the legacy/mini/custom alternatives. Output types
also come from the canonical schema; usage and request identity remain optional
completion metadata, not invented timestamps or clear events.

Python's `speechswitch.providers.openai.synthesize` now implements this operation
through a source-generated wire client. Use `async with`, provide a nonblocking
`HttpTransport`, and consume bytes/done events inside the context. The transport
must return at headers, honor task cancellation, and reject redirects and implicit
retries. `timeout_ms` covers the whole context, including consumer pauses; zero
expires before I/O. Exiting the context releases the body even if unread. An SSE
done event releases the body without waiting for HTTP EOF. `max_event_bytes`
defaults to 4 MiB and `max_json_bytes` bounds error bodies at 16 MiB. Authentication
and model defaults match TypeScript.
Buffered Python audio/error chunks and SSE parsing yield cooperatively so a
scheduled cancellation can interrupt immediately-ready reads and large SSE chunks.

Go's `providers/openai.Synthesize` accepts the same generated model union and
returns `runtime.Input[openai_output.SynthesisItem]`. It uses a source-generated
wire client and native `net/http` by default, with injectable transport and no
redirects. Defer `Close`, including for unread streams. Parent and `Next` contexts
cancel pending reads; `Options.Timeout` can bound the whole operation, including
idle periods between reads. Explicit zero expires before I/O. Error metadata,
custom voice selection, format conversion and SSE completion match Python.
`MaxEventBytes` and `MaxJSONBytes` use zero to select the same default limits.

Rust's `providers::openai::synthesize(&request, &http_backend, options)` returns
an owned `Stream` implementing `InputStream<openai_output::SynthesisItem>`. The
injected backend owns native HTTP/TLS and must reject redirects/retries, register
wakers while pending, and cancel I/O on drop without blocking. Drop the pending
synthesis future or stream to cancel. Use the host executor's timeout to bound
the entire operation; the adapter imposes no executor or timer thread. Done and
terminal errors release the body immediately, and large buffered SSE chunks yield
cooperatively. Auth, defaults, model narrowing, errors and protocol behavior match
the other adapters. Limits default to 4 MiB per event and 16 MiB per error body;
explicit zero limits are rejected.

All four cataloged sources were fetched again on 2026-09-08 using
GET, no request body, redirects enabled and non-2xx rejection. Every byte and
SHA-256 matched the stored snapshot; no source was repaired or rewritten.
The official guide confirms the legacy voice subset; the model page retains
both mini snapshots. The selected OpenAPI graph remains complete for this
operation's request, byte response and referenced SSE events. Python, Go and Rust
wire generation shares the TypeScript contract audit and emits direct types, guards
and transport calls, with no runtime schema interpreter.

Checks use shared exact TypeScript/Python/Go/Rust wire fixtures, native Node and Go
loopback streaming, race-tested cancellation, Rust pending-I/O/drop tests,
changed-source executable generation tests and real language compilers.
All three foreign adapters are implemented on this provider branch. No paid
synthesis call is claimed.
