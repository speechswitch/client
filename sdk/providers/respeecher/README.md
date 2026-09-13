# Respeecher Space TTS

Implements issue #22's `realtime-tts` model using the Space API, not the separate
Marketplace API. `language: "en"` (default) routes to `en-rt`; `"uk"` routes to
`ua-rt`. Text, including Ukrainian inline stress marks, passes through unchanged.
Select a catalog or provisioned custom voice by ID. Space has no public voice
cloning/reference-audio input and exposes no timestamps.

```ts
import { synthesize } from "./sdk/providers/respeecher/index.ts";

const text = (async function* () {
  yield "Hello.";
  yield { command: "flush" } as const;
  yield "This can be interrupted.";
  yield { command: "clear" } as const;
  yield "A fresh utterance.";
})();

for await (const output of synthesize(
  { model: "realtime-tts", voice: "samantha", text },
  { auth: { respeecher: { apiKey: "..." } } },
)) {
  // Handle audio envelopes and clear/flush/done events without buffering.
}
```

Authentication resolves `auth.respeecher.apiKey`, then
`SPEECHSWITCH_RESPEECHER_API_KEY`, then `RESPEECHER_API_KEY`. Node/Bun native
WebSockets authenticate through the `X-API-Key` handshake header, never a query
parameter. Browsers need an authenticated `webSocket` override or whole-text
HTTP mode. Overrides are exclusive to the operation and closed on exit.

## Transports and audio

| Request | Transport | Output |
| --- | --- | --- |
| PCM or mulaw, including omitted output | WebSocket by default | Envelopes with native context IDs |
| PCM or mulaw with `transport: "http"` | `/tts/sse`, actually JSONL | Raw audio chunks |
| WAV, whole text only | `/tts/bytes` | Raw WAV bytes as they arrive |

Default output is mono float32 little-endian PCM at 22050 Hz. PCM also supports
signed 16-bit little-endian samples; WAV is signed 16-bit. Sampling rate is
independent of format, and mulaw does not inherit a guessed telephony-only rate.
The byte endpoint documents an *approximate* 5000-character limit; the adapter
does not invent an exact schema bound for it.

All sampling overrides remain flat in the normalized request. Omission retains
the selected voice's native defaults. `topK: 0` disables filtering (native `-1`);
positive safe integers select the candidate count. `topP` must be strictly
positive. Bounds and integer checks are generated from the canonical schema,
not repeated in the adapter. The new `frequencyPenalty` and `presencePenalty`
concepts are independent of repetition penalty and each other.

Text deltas are sent immediately with `continue: true`. Flush or input EOF sends
an empty final transcript with `continue: false`; flush completion follows the
native context's `done`. Multiple contexts may overlap, and each audio envelope
retains its native context ID. The adapter never invents timestamps or pairs
independently arriving audio by order.

`clear` sends native cancellation for all unfinished contexts, suppresses their
late responses, and emits a **local** playback-clear event. There is no native
cancellation acknowledgement. Respeecher warns that already generated but not
yet streamed audio can still be charged. `signal` and `timeoutMs` cancel the
whole operation, including blocked input and network waits; exiting the
consumer closes the response/socket and calls unfinished input's `return`.
Cleanup does not await an uncooperative producer, which cannot be forcibly stopped.

## Contract audit

The ten raw sources in `schemas/sources/respeecher/` are retained exactly, with URL,
GET method and SHA-256 catalog entries. The discovery manifest's `/docs/` links
are now correct; the issue's stale-link warning is historical.

The structured snapshots are not complete codified contracts: AsyncAPI omits
the required socket-auth mechanism; OpenAPI labels JSONL as `text/event-stream`
and omits required request-body markers; sampling bounds/defaults are prose.
The protocol therefore lives directly in `index.ts`. Only normalized request
validation, specification, registry and foreign-language types are generated.
No static client template, repaired vendor schema or third-party runtime ships.

Tests exercise all transports, native Node header authentication, incremental
first-audio latency, clear/flush interleaving, context correlation, malformed
responses, deadlines, cancellation, source hashes and playground defaults.
They use fixtures and loopback servers, not paid provider calls.

## Python and generated foreign contracts

The Python adapter is implemented in `sdks/python/speechswitch/providers/respeecher.py`.
Its request types, input checks and output envelopes are generated from the canonical
TypeScript schemas, along with the corresponding Go and Rust types. All three
foreign-language Respeecher adapters are implemented on this provider-scoped branch.

```python
from collections.abc import AsyncIterator
from speechswitch.generated.respeecher import TtsRequestObjectTextAsyncIterableItem as Input
from speechswitch.providers.respeecher import synthesize

async def text() -> AsyncIterator[Input]:
    yield "Hello."
    yield {"command": "flush"}
    yield "This can be interrupted."
    yield {"command": "clear"}
    yield "A fresh utterance."

async def speak() -> None:
    async with synthesize({"voice": "samantha", "text": text()}) as stream:
        async for item in stream:
            print(item)
```

Python uses the same scoped/legacy environment names, or shared
`auth={"respeecher": {"api_key": "..."}}`. Its native asyncio WebSocket sends
`X-API-Key` in the upgrade, without external packages. Supply `web_socket` for an
already authenticated, exclusively owned socket. `protocol="http"` selects
whole-text JSONL; WAV selects byte HTTP automatically. HTTP requires an injected
asynchronous `transport` implementing `speechswitch.http.HttpTransport`; it must
release pending requests on cancellation and must not redirect credentials.
`base_url` preserves proxy paths and queries; `web_socket_url` overrides the socket
endpoint directly. Defaults resolve at the public provider boundary.

Always use `async with`, including on early consumer exit. `timeout_ms` covers
connection, input and consumption; task cancellation also closes resources.
An unfinished input iterator is canceled and closed without waiting on a producer
that ignores cancellation. HTTP backends and socket overrides must cooperate with
cancellation. `max_message_bytes` defaults to 4 MiB for each socket message or JSONL
line; JSONL is incremental, UTF-8 safe, bounded and cooperatively scheduled.
Buffered WAV chunks also yield to the event loop so scheduled cancellation remains
effective when HTTP reads are immediately ready.
Clear/flush retain the TypeScript semantics above, including local-only clear and
suppression of canceled contexts' late output.

On 2026-09-07 at 12:16:48–49 UTC all ten cataloged sources were freshly fetched
with GET, no request body, redirects followed and non-2xx responses rejected.
Every SHA-256 matched the catalog; no snapshot or hash needed changing.
The September 13 refresh returned HTTP 200 for all ten sources. AsyncAPI and the
discovery manifest stayed identical; eight snapshots changed and retain their
new raw bytes and catalog hashes. Changes rename OpenAPI operation IDs, fix docs
links and clarify JSONL response fields, without changing wire capabilities.
Shared TypeScript/Python fixtures check exact requests and every JSONL byte split.
Python tests also cover native socket auth, backpressured writes, overlapping
contexts, malformed packets, deadlines, body ownership and an uncooperative
producer. Negative Pyright tests assert exact diagnostic rules and locations.

## Go

`sdks/go/providers/respeecher.Synthesize` takes the generated
`generated/respeecher.TtsRequest` and returns `runtime.Input` of the generated
Respeecher output union. Both value and pointer variants are supported after
generated validation. Model/audio/input restrictions stay in the canonical schema;
the adapter only converts to the native protocol. No runtime dependency was added.

```go
import (
    "context"
    "io"
    schema "github.com/speechswitch/client/sdks/go/generated/respeecher"
    "github.com/speechswitch/client/sdks/go/providers/respeecher"
)

func speak(ctx context.Context) error {
    audio, err := respeecher.Synthesize(ctx, schema.TtsRequestAsObject{
        Value: schema.TtsRequestObject{
            Voice: "samantha",
            Text: schema.TtsRequestObjectTextAsString{Value: "Hello."},
        },
    }, respeecher.Options{}) // Uses the scoped/legacy API-key environment variable.
    if err != nil { return err }
    defer audio.Close()
    for {
        item, err := audio.Next(ctx)
        if err == io.EOF { return nil }
        if err != nil { return err }
        _ = item // Handle generated audio/clear/flush/done variants.
    }
}
```

Go uses native HTTP and header-authenticated WebSockets by default. `Transport`
injects HTTP/upgrade I/O; `WebSocket` overrides an already authenticated, exclusively
owned socket. `Protocol: "http"` selects JSONL for whole-text PCM/mulaw; WAV always
uses byte HTTP. `BaseURL` retains encoded proxy paths and query strings;
`WebSocketURL` overrides the socket endpoint. Shared `Auth` takes precedence over
scoped/legacy environment values, including an explicit empty key blocking fallback.

Validation and defaults resolve during `Synthesize`; I/O starts on the first
`Next`. Always call `Close`, even on an unread stream. Both operation and `Next`
contexts can cancel the operation; optional `TimeoutMs` adds a whole-operation
deadline. `MaxMessageBytes` uses zero for a 4 MiB default. Input is acquired only
after a successful socket connection. Unfinished producers are closed without
waiting for uncooperative application code. Backpressured socket writes do not
block reads, and native context IDs survive overlapping synthesis and cancellation.
Resources close at protocol completion, without waiting for another consumer pull.

Tests consume all shared request/JSONL fixtures, check native HTTP/socket auth and
first-chunk delivery with loopback servers, reject redirects, exercise cancellation
at headers/body/input/idle output, and assert exact negative Go compiler output.
No paid Respeecher inference call is claimed.

## Rust

`sdks/rust/src/providers/respeecher` consumes the generated `TtsRequest` and returns
an owned `Stream` implementing `InputStream<SynthesisItem>`. The adapter uses the
same handwritten Space protocol and all shared request/JSONL fixtures. The schema
keeps WAV input whole-text-only and timestamps exactly empty across all languages.

```rust
use speechswitch_types::{
    generated::auth::Auth,
    http::{HttpTransport, TransportError},
    providers::respeecher::{synthesize, Options, TtsRequest},
    runtime::InputStream,
    websocket::WebSocketTransport,
};
use std::{future::poll_fn, pin::Pin};

async fn speak(request: TtsRequest, auth: &Auth,
               http: &dyn HttpTransport, sockets: &dyn WebSocketTransport)
    -> Result<(), TransportError>
{
    let mut stream = synthesize(request, Options {
        auth: Some(auth), transport: Some(http),
        web_socket_transport: Some(sockets), ..Default::default()
    }).await?;
    while let Some(item) = poll_fn(|cx| Pin::new(&mut stream).poll_next(cx)).await {
        let _ = item?; // Handle generated bytes/context audio and clear/flush/done.
    }
    Ok(())
}
```

The Rust crate bundles no HTTP/TLS backend or executor. Inject native transports;
the provider supplies the `X-API-Key` upgrade header, endpoint and message limit.
Backends verify TLS, reject credential-bearing redirects and own their connections.
An owned `web_socket` override requires an injected `entropy` source for context
IDs; otherwise native WebSocket backends supply operating-system randomness.
Whole-text HTTP needs no entropy. Scoped/legacy environment fallback and explicit
empty-key behavior match Python/Go; non-UTF-8 environment credentials fail closed.

Dropping the future cancels a pending handshake/HTTP request and releases owned
input; dropping the returned stream cancels between polls too. Apply operation
deadlines with the host executor, dropping the future/stream on expiry. Backends
and producers must keep polling and destruction nonblocking. The returned stream
does not borrow the request, auth or backend and drops transport resources at
terminal success/error, before yielding `done` or the error. Socket reads progress
while writes are backpressured, each text delta is sent without look-ahead, and
clear cancels all unfinished contexts while suppressing their late responses.

The 4 MiB default `max_message_bytes` bounds socket messages and JSONL lines;
zero is rejected. HTTP framing is UTF-8 safe and processes at most 8192 buffered
bytes per poll before yielding. Tests check every shared JSONL byte split, native
connect configuration, drop during headers/handshake/body/input, early/silent
completion, error preservation, auth precedence and bounded processing. Exact Rust
compiler diagnostics reject unsupported formats, streaming WAV, reference audio,
timestamps, model IDs and nonempty timestamp output. No live inference is claimed.
