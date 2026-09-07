# Smallest.ai

Handwritten HTTP, SSE and WebSocket synthesis for `lightning-v3.1` and
`lightning-v3.1-pro`. The plain canonical request lives in
[`schemas/providers/smallest.ai/index.ts`](../../../schemas/providers/smallest.ai/index.ts).
TypeScript 7 generates request validation, playground model variants and
Rust/Python/Go request types from it. There is no handwritten parallel schema,
third-party runtime dependency, or vendor wire codegen.

## Usage

```ts
import { synthesize } from "./sdk/providers/smallest.ai/index.ts";

for await (const item of synthesize({
  model: "lightning-v3.1-pro",
  voice: "meher", // Or an existing cloned voice ID from this model's pool.
  text: "Hello from SpeechSwitch.",
  output: { format: "pcm", sampleRateHz: 24000 },
}, { auth: { "smallest.ai": { apiKey: "..." } } })) {
  if (item instanceof Uint8Array) {
    // Feed bytes to your consumer as they arrive.
  }
}
```

Authentication precedence is `auth["smallest.ai"].apiKey`,
`SPEECHSWITCH_SMALLEST_API_KEY`, then `SMALLEST_API_KEY`. Whole text defaults to
SSE; incremental input and word timestamps select WebSocket. Set
`transport: "http"` explicitly for the upstream non-streaming binary endpoint.
All paths still return one async audio stream; buffering belongs to the consumer.

Native WebSockets use an `Authorization: Bearer` upgrade header on Node 22.18+
and Bun, with optional `x-expire-content`. No API key is placed in the query or
subprotocol. Browser callers should use SSE or supply an already-authenticated
`webSocket`. An injected socket is exclusively owned and closed on completion,
failure, cancellation or iterator return. Configure an override's idle timeout and
headers before passing it; `idleTimeoutSeconds` applies to native construction.
Fetch and socket transports, URLs, abort signals and deadlines are injectable.

## Model and option boundaries

| Capability | Standard | Pro |
| --- | --- | --- |
| Normalized model | `lightning-v3.1` | `lightning-v3.1-pro` |
| Native model | `lightning_v3.1` | `lightning_v3.1_pro` |
| Explicit language codes | 20, plus `auto` | 31, plus `auto` |
| Existing cloned voice | From the standard pool | From the Pro pool |
| Whole text / streamed input | Both | Both |
| Word timestamps | Documented English/Hindi aligner families only | Same restriction |

Lightning v2 in the original issue is **retired**, not a supported model. The
[official changelog](https://docs.smallest.ai/models/changelog/lightning-v-3-1)
records its 410 responses. The current model cards and contracts supersede older
changelog entries about language routing. No attempt is made to revive dead v2
endpoints or silently substitute a model.

- Default output: mono signed 16-bit little-endian PCM at 44100 Hz. PCM, WAV,
  MP3, mulaw and alaw retain independent 8000/16000/24000/44100 sample-rate choices.
  Encoded formats reject PCM-only byte-order/sample-encoding options. Returned
  bytes retain native framing, including any per-chunk container framing.
- `speed` is a 0.5–2 multiplier. Untimed synthesis explicitly defaults `language`
  to `auto`, rather than native Pro omission's mixed English/Hindi selection.
  `numberPronunciationLanguage` remains independent because synthesis language is
  always sent explicitly. `formulaReading: "plain_text"` enables native math
  operator reading; `false` preserves ordinary number normalization.
- `pronunciationDictionaries: [{ id }]` selects existing dictionaries over
  HTTP/SSE; pinned versions and WebSocket dictionaries are not documented and are
  not invented. Creating dictionaries or cloning voices is outside synthesis.
- `contentRetentionDays: 7` opts enterprise requests into deletion after seven
  days. This is **not** zero-retention or model-training opt-out.
- `sessionId` and `requestId` are caller correlation labels, not audio/timestamp
  association keys. The latter uses the provider's generated `request_id`.
- Whole text is trimmed at the public boundary, then generated validation
  enforces non-whitespace input and the 8000-code-point maximum. Stream fragments
  preserve whitespace and are sent without look-ahead; no undocumented total
  stream or per-fragment text limit is fabricated.

Timestamp requests narrow `voice` to `meher`, `devansh`, `kartik`, `maithili`,
`liam` or `avery`, and `language` to `en`/`hi` (default `en`). Arbitrary catalog or
custom voices remain available in untimed variants. Word events preserve the
original text, native word index and seconds-to-milliseconds intervals. Audio and
timestamps are independent ordered envelopes with native synthesis `correlationId`;
there is no fabricated chunk pairing, character offset or global timeline offset.

## Incremental input and continuations

Ordinary `AsyncIterable<string>` uses legacy buffering, sends `continue: true`
fragments immediately and sends one final `flush: true` at input EOF. Its
`maxBufferDelayMs` (0–1000, default 0) and `completionDelayMs` (0–10000, default
4000) map to the documented native controls. A native `complete` before input
EOF fails instead of truncating the producer and reporting success. Empty input
completes locally without issuing empty synthesis requests. This mode does not
claim support for clear/update commands or midstream flushes.

Opt into prosody-preserving continuation mode with
`continuation: { id, maxBufferDelayMs? }`; its delay is 0–5000 (default 3000).
The authored union excludes legacy buffering knobs in this mode. Input permits
strings and `{ command: "clear" }`. The SDK sends the documented
`cancel_request: true` for that context and yields a **local** `{ event: "clear" }`.
It is not a server acknowledgment and does not promise cancellation of already
released/in-flight audio. Known older echoed external request IDs are dropped;
missing or unknown identity after clear fails rather than guessing freshness.
Hard-stop barge-in uses `AbortSignal` and a new synthesis call, plus clearing the
consumer's playback buffer.

Crucially, the [continuation protocol](https://docs.smallest.ai/models/documentation/text-to-speech-lightning/continuations)
has **no final context-complete event**. Every released segment has its own
`complete`; an empty closing frame can produce no response, and `context_id` is
not echoed. The SDK therefore exposes segment completions as
`{ event: "batch", requestId }`, sends `continue: false` at input EOF, and keeps
draining until the caller cancels/returns. This mode requires a signal or deadline.
Neither an idle interval, a socket close nor the first segment completion is
treated as a successful final `done`. Timeouts reject. Do not use `Array.fromAsync`
expecting a finite successful continuation result. Prefer ordinary streamed input
when a definitive final completion is required.

## Why no wire codegen

Twelve unchanged snapshots are recorded with URL, GET method and SHA-256 in
[`schemas/sources.yaml`](../../../schemas/sources.yaml). Issue #24 and all comments
were read (no comments). Its original generation recipe is superseded by the
repository's complete-contract requirement:

- AsyncAPI requires text and voice on every message, while context-close frames
  explicitly may omit both. It omits `cancel_request` and `output_format`, and
  leaves supported sample-rate choices in prose.
- Server status/data fields are optional and do not form valid discriminated
  response shapes; native errors are outside the reachable response enum.
- OpenAPI describes SSE as an opaque string and binary success as WAV despite
  documenting several output encodings. Model-specific language and alignment
  constraints are not expressed as structural variants.
- The official Fern overrides only rename/group endpoints. They do not repair
  these gaps. The Python SDK is a secondary framing reference, never a generation
  input or imported runtime dependency.

The adapter implements the wire protocol directly. The schema project still
generates specialized normalized request checks and foreign-language types.

Re-fetched all 12 cataloged URLs with GET on 2026-09-07 at 14:17 UTC, following
redirects and rejecting non-2xx responses. Every response matched its cataloged
SHA-256, including the OpenAPI, AsyncAPI, continuation guide and secondary SDK
reference. The existing raw inputs are retained unchanged; the contract gaps
above remain.

## Python

`speechswitch.providers.smallest_ai.synthesize` implements SSE, binary HTTP and
native WebSockets. Request/input types and validators come from the canonical
TypeScript request. Output envelopes, batches and completion events are generated
from the same provider schema in `smallest_ai_output`; none is a separate Python
schema or vendor wire-codegen template.

```python
from speechswitch.providers.smallest_ai import synthesize

async def speak():
    async with synthesize({
        "model": "lightning-v3.1-pro", "voice": "meher", "text": "Hello.",
        "timestamp_granularity": "word",
    }, timeout_ms=30_000) as stream:
        async for item in stream:
            print(item)  # Consume audio and independently timestamped envelopes.
```

Use `auth={"smallest_ai": {"api_key": "…"}}` or the same scoped/legacy environment
variables as TypeScript. Whole text defaults to SSE and needs `transport`, an
injected asynchronous `HttpTransport` that returns at headers, rejects redirects
and releases in-flight work on cancellation. `protocol="http"` selects the binary
endpoint. Incremental input and timestamps select native asyncio WebSockets with
upgrade-header authentication; `protocol="websocket"` also selects them explicitly.
No third-party runtime dependencies are added.

`base_url` preserves proxy paths and queries. `web_socket_url` supplies a complete
WS(S) endpoint; native construction sets its `timeout` query from
`idle_timeout_seconds` (default 60). `web_socket` is an exclusive, already
authenticated/configured override, closed on context exit even if unread or
rejected during validation. `max_message_bytes` defaults to 4 MiB and bounds
socket messages and individual SSE events, not total audio or text length.

Always use `async with`. Task cancellation, context exit and `timeout_ms` release
owned transport work; the timeout covers consumer backpressure too. Cleanup does
not wait for an application producer that ignores cancellation. Reads continue
while sends are backpressured, without prefetching the next input item.

Python's owned async context is the caller-controlled lifetime for continuation
mode; it does not require a TypeScript-style `AbortSignal`. Leaving the context or
canceling the task ends it, and an optional deadline rejects with `TimeoutError`.
Input EOF sends the context-closing frame but does not make the output iterator
finite. Segment completions remain batches; silence and socket closure never
become successful final done. Use ordinary streamed input for finite synthesis.
Native clear remains a local event with the limited cancellation semantics above.

Python tests cover all twelve request variants, shared TypeScript wire fixtures,
SSE at every byte split, native loopback authentication/fragmentation, lifecycle
and backpressure, stale/ambiguous clear identity, early completion, final-write
failures and exact compiler diagnostic projections. No live credentialed inference
was performed. Go and Rust adapters are described below on this same provider
branch.

TypeScript, Python and Go detect premature legacy completion at frame receipt.
A paused consumer cannot let a later input EOF relabel that buffered frame as
successful completion; dedicated regressions cover that ordering.
Rust polls receive before advancing input, including on input's fairness turn,
so buffered completion is checked before later EOF can change the input state.

## Go

`sdks/go/providers/smallest_ai.Synthesize` uses the generated request types in
`generated/smallest_ai`, generated validators, and generated output envelopes in
`generated/smallest_ai_output`. The adapter implements the wire protocol directly,
with no third-party runtime dependencies.

```go
request := smallest_ai.TtsRequestAsLightningV31TextVoice5e2ae2e5{
    Value: smallest_ai.TtsRequestLightningV31TextVoice5e2ae2e5{
        Text: "Hello", Voice: "existing-voice-id",
    },
}
audio, err := provider.Synthesize(ctx, request, provider.Options{})
if err != nil {
    return err
}
defer audio.Close()
for {
    item, err := audio.Next(ctx)
    if err == io.EOF {
        break
    }
    if err != nil {
        return err
    }
    // Handle bytes, ordered timestamp envelopes, and provider events.
    _ = item
}
```

Here `smallest_ai` is the generated schema package and `provider` aliases the
provider package. Set `SPEECHSWITCH_SMALLEST_API_KEY` or `SMALLEST_API_KEY`, or pass
the shared `Options.Auth.SmallestAi` entry. Explicit credentials take precedence,
including an explicitly empty credential that rejects rather than falling back.

The first `Next` starts networking; request validation and configuration resolve
at `Synthesize`. Whole text defaults to SSE; `Protocol: "http"` selects byte-native
HTTP. Incremental text and word timestamps select WebSockets with native bearer
upgrade-header auth. `Transport` and exclusively owned `WebSocket` are injectable.
`BaseURL` preserves proxy paths/queries; `WebSocketURL` is a complete endpoint.
`IdleTimeoutSeconds` configures the native socket timeout (default 60).

Ordinary input is `runtime.Input[string]`; continuation input uses the generated
string/clear union. Model-specific types retain language/voice narrowing and
prevent legacy controls or pronunciation dictionaries on continuation streams.
Both modes preserve text fragments verbatim. Whole text is trimmed with ECMAScript
whitespace semantics before generated validation, without modifying caller values.

Always close the stream. Parent or active-`Next` context cancellation and
`TimeoutMs` interrupt pending headers, body reads, socket writes and input reads.
Continuations emit clear/batch events and independently correlated timestamp/audio
envelopes; native segment completion never becomes final done. Their lifetime is
the caller's context and `Close`, including after input EOF. Clear suppresses only
known stale echoed external request identities; ambiguous identities fail.

Go tests cover all twelve generated request variants as values and pointers,
all five codecs and four sample rates, shared fixtures at every SSE byte split,
native loopback auth/fragmentation, cancellation/backpressure, premature completion,
failed final writes and nine exact compiler-negative diagnostics. No live
credentialed inference was performed.

## Rust

`speechswitch_types::providers::smallest_ai::synthesize` uses the generated
`smallest_ai::TtsRequest` and `smallest_ai_output::SynthesisItem` contracts, both
re-exported from the provider module. Validation comes from the same TypeScript
schema as the other three languages; the incomplete vendor contracts do not
generate a wire client.

```rust
use speechswitch_types::{
    providers::smallest_ai::{synthesize, Options},
    runtime::InputStream,
};
use std::{future::poll_fn, pin::Pin};

let mut audio = synthesize(request, Options {
    transport: Some(&http),
    web_socket_transport: Some(&websockets),
    ..Default::default()
}).await?;
while let Some(item) = poll_fn(|cx| Pin::new(&mut audio).poll_next(cx)).await {
    let item = item?;
    // Handle bytes, ordered timestamp envelopes, and provider events.
}
```

`request` is a generated model-specific request. HTTP/TLS and WebSocket backends
are injected through the existing executor-independent transport contracts; Rust
does not impose a networking library, executor, or third-party runtime dependency.
The provider constructs native bearer upgrade headers, retention headers, proxy
paths and timeout queries before calling those backends. Use the shared
`Auth.smallest_ai` entry or the same scoped/legacy environment variables.

Unlike Go's lazy first `Next`, awaiting Rust's `synthesize` performs the HTTP
submission or socket handshake. It returns an owned stream that does not borrow
the request, credentials or backend. Drop the pending future or stream to cancel.
Apply a whole-operation deadline in the host executor; `idle_timeout_seconds`
(default 60) is the provider's socket setting, not successful context completion.
`max_message_bytes` defaults to 4 MiB per socket message or SSE event; zero is
invalid. Terminal SSE audio releases its body before the final done event.

An exclusive `web_socket` override is dropped on preflight rejection, cancellation
and completion. It must already be authenticated/configured. Supply `entropy`
when new request identities are needed with an override; otherwise native backends
supply OS entropy. An ordinary request with an explicit `request_id` needs no
entropy. Continuations use a random connection prefix plus a checked counter,
skipping identities already invalidated by clear.

Ordinary streaming accepts `StreamingInput<String>`; continuations accept the
generated string/clear input enum. Validation checks the original input type
before conversion. Continuations remain open after input EOF and emit native
batches, never a guessed final done. Independent native timestamp/audio request IDs
remain separate ordered envelopes. No reference audio or clone-creation API is
invented; existing cloned voice IDs remain available on untimed variants.

Rust tests cover shared fixtures and every SSE byte split, all twelve request
variants, all codecs/rates, exact errors, generated input narrowing, drop ownership,
backpressure, premature completion, stale clear identities and nine exact negative
compiler diagnostics. Socket tests use injected native backends, not credentialed
live inference.

## Verification and remaining scope

Tests cover exact wire payloads, native Node loopback HTTP/WebSocket auth,
incremental delivery, split SSE frames, independent timestamp association,
premature completion, continuation batches, clear identity handling, aborts,
deadlines, malformed frames, response ownership, model narrowing and playground
defaults. No credentialed live synthesis was run.

Rust, Python and Go compile generated request/output types and executable request
validators, including model-specific narrowing. Python, Go and Rust implement the
provider protocols described above.
