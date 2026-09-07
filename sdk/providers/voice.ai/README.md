# Voice.ai

Handwritten TTS integration with both the original issue's
`POST https://api.voice.ai/tts/v2/audio/speech` and the current
`https://dev.voice.ai/api/v1` API. One `synthesize` operation always returns a
stream; consuming the complete stream is an explicit caller operation.

```ts
import { synthesize } from "./index.ts";

const auth = { "voice.ai": { apiKey: "..." } };
for await (const item of synthesize({ text: "Hello", voice: "existing-cloned-id" }, { auth })) {
  // HTTP audio items are Uint8Array. The final item is { event: "done" }.
}
```

Authentication resolves `auth["voice.ai"].apiKey`, then
`SPEECHSWITCH_VOICE_AI_API_KEY`, then `VOICE_AI_API_KEY` at the public boundary.
The native WebSocket sends `Authorization: Bearer ...` as an upgrade header in
Node/Bun, never as a query token or fabricated subprotocol. Browser WebSockets
cannot set that header: use a backend or an authenticated `webSocket` override.
Keep permanent API keys on the server.

## Model and API selection

The provider-owned TypeScript union drives validation, playground options and
generated Rust/Python/Go requests. Base request types remain variant-union-free.

| Request selection | Language | Default transport |
| --- | --- | --- |
| Omitted model or `model: "auto"` | `en` by default; selects the standard or multilingual hosted model from language | Streaming HTTP for whole text |
| Standard `voiceai-tts-v1-latest` or `voiceai-tts-v1-2026-02-10` | English | Streaming HTTP for whole text |
| Lite `voiceai-tts-lite-v1-latest` or `voiceai-tts-lite-v1-2026-04-15` | English | Streaming HTTP for whole text |
| Multilingual `voiceai-tts-multilingual-v1-latest` or `voiceai-tts-multilingual-v1-2026-02-10` | Required `ca`, `sv`, `es`, `fr`, `de`, `it`, `pt`, `pl`, `ru`, or `nl` | Streaming HTTP for whole text |
| `apiVersion: "tts-v2"` | Not exposed by that API; `voice` required | Legacy HTTP with `streaming: true` |

Modern `apiVersion` defaults to `v1`. `model: "auto"` is normalized model routing,
not an invented upstream model ID or ASR language auto-detection. Explicit `http`
transport selects `/api/v1/tts/speech` (or legacy `streaming: false`), still read
incrementally by the SDK. Input streaming and paced audio require the
structured WebSocket protocol; an incompatible transport override fails before
network access. Lite is not in the captured HTTP model enum, but the current
quickstart explicitly documents hosted IDs in any TTS request. The handwritten
adapter follows that guide instead of copying the stale enum's restriction.

Voice IDs select existing built-in or cloned voices. Omit `voice` on the current
API to use its built-in default. Reference-audio upload/voice creation is not a
synthesis input and is not conflated with voice selection.

## Output and pronunciation

Keep `output.format`, `sampleRateHz`, and `bitRateBps` independent. Provider unions
encode every documented MP3, Opus, PCM, WAV, A-law and mu-law combination. Basic
modern MP3/WAV/PCM use 32 kHz; PCM is mono signed 16-bit little-endian. Legacy
sample rate/PCM layout and the native Opus container are not guessed from another
endpoint. `audioDelivery: "paced"` requires explicit PCM or telephony output and
uses WebSocket; MP3/WAV/Opus cannot silently fall back to raw cadence.

Use `pronunciationDictionaries: [{ id: "existing-dictionary", version: 2 }]` for
one managed dictionary. Omit `version` for latest; this numeric revision is not
an opaque `versionId`. Temperature/top-p accept zero on the current API. The
legacy contract instead narrows them to 0.8–1.2 and 0.4–0.9 respectively.

## Incremental text, flush and clear

Modern `text` also accepts `AsyncIterable<string | { command: "flush" } |
{ command: "clear" }>`. Settings are fixed per synthesis call; the documented
subsequent messages do not accept pronunciation/model/voice updates.

- Text accumulates in a native context until flush or input EOF. Empty text and
  flushing an empty buffer are no-ops, not fabricated native acknowledgments.
- Each nonempty flush uses `auto_close: true`; later text gets a new native
  context so input/clear handling does not block behind in-flight generation.
- Audio envelopes carry the exact echoed `context_id` as `correlationId` with
  `correlation: "ordered"` and empty timestamps. Concurrent contexts can interleave:
  keep their audio separate, especially for independently headed file formats.
- `is_last` yields `{ event: "flush", correlationId }`. The distinct
  `context_closed` acknowledgment releases that context. There is no fabricated
  second input-group ID; the shared flush event now allows it to be absent.
- Clear retires all previous contexts and immediately suppresses their subsequent
  audio. Buffered contexts receive `close_context`; already flushing contexts are
  awaiting native auto-close, so no racing duplicate close is sent. The clear event
  waits for their closure acknowledgments. With no active contexts it completes
  locally. Native closure is **not documented as hard inference cancellation**,
  and it does not stop audio already queued in a consumer's player.
- Done requires input EOF and every active context to close. Premature socket
  closure, missing flush completion, unknown context IDs and empty generation
  fail. Caller abort/timeout closes transport and requests producer cleanup without
  waiting for an uncooperative producer's pending `next` or `return`.

`maxMessageBytes` bounds individual JSON socket frames (default 4 MiB), not raw
HTTP audio. Network dependencies are injectable; no third-party runtime package
is shipped. There is no silence timer masquerading as successful completion,
automatic retry, or cancellation billing guarantee.

## Contract provenance

All nine freshly acquired inputs remain unchanged under
`schemas/sources/voice.ai/`, with exact URLs/methods/SHA-256 in `schemas/sources.yaml`.
The public OpenAPI 1.4.0 describes the old endpoint with no response body schema,
no auth scheme, and constraints only in prose. Current endpoint Markdown embeds
OpenAPI 1.5.0 with different models, bounds and hosts. Generating a wire client
from the old document would lose current capabilities; repairing it by hand would
misrepresent its provenance. The adapter is therefore handwritten.

The captured WebSocket Markdown includes structured channel operations and
`jsonPayloadSchema` definitions, satisfying the issue's structured-protocol gate.
It is not passed off as a fetched standalone AsyncAPI document (that URL returned
404). Source tests parse the fenced YAML deterministically, preserve the separate
audio/flush/closure messages, and audit the HTTP/WS model difference. The single
context socket is also cataloged; the adapter uses the documented multi-context
endpoint to support repeated flushes and independent context identity.

Tests use exact payload/diagnostic assertions, native Node HTTP and authenticated
WebSocket loopback servers, generated schema validation and playground defaults.
No credentialed live provider synthesis has been performed.

The Python implementation audit re-fetched all nine cataloged URLs on 2026-09-07
with redirects and TLS verification enabled. All returned HTTP 200 with identical
SHA-256 values, so no raw snapshot or catalog hash was changed. Issue #27 remained
open and had no comments. Its old OpenAPI still lacks response/auth schemas; the
current structured socket source still distinguishes `is_last` from
`context_closed`, includes Lite and uses upgrade-header authentication.

## Python

`speechswitch.providers.voice_ai.synthesize` implements the same nine request
variants, native HTTP endpoints and multi-context socket lifecycle. Its public
request, executable validation and output types are generated from TypeScript.
The provider-owned `SynthesisItem` union is now exported from the schema rather
than duplicated in adapters. `VoiceAiEnvelope.timestamps` is an exact empty
tuple in Python, not a fabricated timestamp stream.

```python
from speechswitch.providers.voice_ai import synthesize

async with synthesize(
    {"text": "Hello!", "voice": "existing-clone"},
    auth={"voice_ai": {"api_key": "..."}},
    transport=transport,
) as stream:
    async for item in stream:
        consume(item)
```

HTTP uses an injected asynchronous `HttpTransport` that returns at headers,
releases work on cancellation, and rejects redirects, implicit retries and ambient
credentials. WebSocket uses the dependency-free native transport with Bearer
upgrade headers; `web_socket` can override it with an authenticated socket whose
ownership transfers to this call. An override closes even if validation fails.
No HTTP transport is needed for incremental text or paced audio.

`protocol` selects `"stream"`, `"http"` or `"websocket"`; omission follows the
TypeScript selection rules. `base_url` preserves a proxy path and selects the
corresponding HTTP/WS scheme. `timeout_ms` covers acquisition, synthesis, source
waits and consumer idle time. `max_message_bytes` bounds incoming and outgoing
socket frames in UTF-8 bytes (default 4 MiB), never raw HTTP audio.

Use `async with` even when stopping early. Cancellation releases the connection
and cancels pending local tasks without waiting for an uncooperative producer;
producer cleanup completes once its pending read settles. Reads continue while
a socket write is pending, but done never hides a failed write. Context IDs are
preserved verbatim, and a clear waits for closure acknowledgments while suppressing
old audio. Neither clear nor local cancellation guarantees stopped inference,
billing or playback already queued by the consumer.

The shared `sdks/fixtures/voice_ai.json` cases run against TypeScript, Python, Go and Rust,
including all nine variants, native wire settings and exact invalid-frame errors.
Python tests also use a real loopback WebSocket upgrade, masked client frames and
fragmented server messages. Eight exact compiler diagnostics cover unsupported
model/language, paced output, dictionary revisions, update events, nonempty timing,
legacy streaming input and wrong adapter requests. All three foreign adapters live
on this same provider branch.

## Go

`providers/voice_ai.Synthesize` accepts the generated `voice_ai.TtsRequest` and
returns `runtime.Input[voice_ai_output.SynthesisItem]`. Both HTTP and WebSocket
have dependency-free native transports; `Transport` and `WebSocket` are optional
overrides. The HTTP override must return at headers and reject redirects, retries
and ambient credentials. An injected socket is exclusively owned and must already
be authenticated; native sockets use the Bearer upgrade header.

```go
import (
    "context"
    "io"

    schema "github.com/speechswitch/client/sdks/go/generated/voice_ai"
    voiceai "github.com/speechswitch/client/sdks/go/providers/voice_ai"
    "github.com/speechswitch/client/sdks/go/runtime"
)

stream, err := voiceai.Synthesize(ctx, schema.TtsRequestAsObject1ec54d36{
    Value: schema.TtsRequestObject1ec54d36{
        Text: schema.TtsRequestObject1ec54d36TextAsString{Value: "Hello!"},
        Voice: runtime.Some("existing-clone"),
    },
}, voiceai.Options{Auth: sharedAuth})
if err != nil { return err }
defer stream.Close()
for {
    item, err := stream.Next(context.Background())
    if err == io.EOF { break }
    if err != nil { return err }
    consume(item)
}
```

`Auth.VoiceAi.Value.ApiKey` overrides `SPEECHSWITCH_VOICE_AI_API_KEY`, then
`VOICE_AI_API_KEY`. An explicitly present empty key is rejected. `Protocol`
selects `"stream"`, `"http"` or `"websocket"`; omission chooses WebSocket for
incremental input or paced delivery, otherwise streaming HTTP. `BaseURL` preserves
escaped proxy paths. `TimeoutMs` includes consumer idle time; `MaxMessageBytes`
bounds socket frames only (zero selects 4 MiB).

Validation and defaults resolve before I/O. First `Next` starts the transport,
and input ownership begins only after a successful socket handshake. Always
`Close`, including when stopping early. The parent context, an active `Next`
context, explicit close or the configured timeout cancels the entire operation.
Network cleanup does not wait for an uncooperative input producer's cleanup.

At most one input pull, socket read and socket write are pending at a time.
Reads can progress while a write is pending, but `done` never masks a failed
write. Audio retains native context IDs and exact empty timestamp arrays; flush
completion and context closure remain distinct. Clear acknowledgments wait for
closure and suppress retired audio, without claiming hard inference cancellation.

Go tests exercise all nine shared request fixtures, every output format/rate/bitrate,
interleaved contexts, overlapping clears, malformed protocol sequences, native
authenticated/fragmented sockets, streaming HTTP and late-acquisition cleanup.
Race-detector tests cover pending I/O and idle cancellation. Six exact Go compiler
diagnostics reject unsupported model languages, paced MP3, legacy streaming input,
string dictionary revisions, fabricated timestamps and unwrapped adapter requests.

## Rust

`providers::voice_ai::synthesize` consumes the generated `TtsRequest` and returns
a stream implementing `InputStream<SynthesisItem>`. It supports the same nine
request variants and HTTP/WebSocket routes, with no additional runtime dependency.
`Options::protocol` is `Option<Protocol>`; omission follows the same transport
selection rules as TypeScript. Shared auth and environment precedence match Go.

Rust uses injected executor-independent `HttpTransport` and `WebSocketTransport`
backends. The provider builds the URL, Bearer upgrade headers and explicit JSON
messages; the backend owns native TCP/TLS, bounded framing and certificate checks.
It must return HTTP responses at headers, reject redirects/retries/ambient
credentials and release pending I/O when its future or stream is dropped.
An already-authenticated `web_socket` override is exclusively owned. Correlation
IDs use the backend's OS randomness or an injected `Entropy` source, never a clock
or predictable fallback.

```rust
use speechswitch_types::{
    providers::voice_ai::{self, Options},
    runtime::InputStream,
};
use std::{future::poll_fn, pin::Pin};

let mut stream = voice_ai::synthesize(request, Options {
    auth: Some(&shared_auth),
    transport: Some(&http),
    web_socket_transport: Some(&websocket),
    ..Options::default()
}).await?;
while let Some(item) = poll_fn(|cx| Pin::new(&mut stream).poll_next(cx)).await {
    consume(item?);
}
```

Drop the synthesis future to cancel a pending handshake/request, or the stream to
cancel synthesis, including while the consumer is idle. Apply deadlines using the
host executor. The owned producer is never polled before a successful handshake;
dropping an established stream releases the socket before the producer. Backends
and producers must have nonblocking polls and destructors. Local cancellation and
clear do not guarantee stopped inference, billing or already-buffered playback.

Reads and writes progress independently with one in-flight write, bounded work per
poll and explicit wakeups when yielding to the executor. Native audio is emitted
only within an active flush, `is_last` emits a flush event, and `context_closed`
releases the context. Clear acknowledgments wait for all affected closures; a
session-local numeric watermark suppresses late retired frames without retaining
an ever-growing ID set. Done requires input EOF, all closures and successful writes.

Rust runs the shared request/protocol fixtures, every codec/rate/bitrate mapping,
interleaved and cleared context tests, and cancellation/handshake ownership tests.
Seven exact compiler diagnostics cover model-specific languages, paced output,
legacy streaming input, dictionary revision types, fabricated timestamps,
unsupported updates and the adapter's generated request boundary.
