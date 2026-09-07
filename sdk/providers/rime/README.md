# Rime

Handwritten integration for Coda, Mist v3 and Mist v2. Whole text uses byte-native
HTTP; incremental text, requested timestamps, or explicit segmentation use the
preferred JSON WebSocket `/ws3`. The operation is always `synthesize`, returning
streamed output rather than collecting an utterance first.

```ts
import { synthesize } from "@speechswitch/router";

for await (const item of synthesize("rime", {
  model: "coda",
  voice: "astra", // or an existing enterprise-clone UUID
  text: "Hello from Rime.",
  output: { format: "pcm", sampleRateHz: 24000 },
})) {
  if (item instanceof Uint8Array) {
    // Play signed 16-bit little-endian PCM, incrementally.
  }
}
```

Authentication precedence is `auth.rime.apiKey`, `SPEECHSWITCH_RIME_API_KEY`, then
`RIME_API_KEY`. HTTP and native Node/Bun WebSockets send `Authorization: Bearer …`.
Keys never enter the connection query or subprotocol. Browser WebSockets cannot
set that header: use your backend, or inject an already-authenticated
`webSocket: WebSocketLike`. An override is exclusively owned and closed by this
call, and must already have the synthesis query configured. It never falls back
to a real network connection. `fetch`, `baseUrl` and `webSocketUrl` are injectable;
regional endpoints can be selected through the latter two. A WebSocket URL
includes the path; an HTTP base URL receives `/v1/rime-tts`.

## Models and normalized options

| Model | Languages | Preferred streaming formats | Inline controls |
| --- | --- | --- | --- |
| `coda` | en, es, fr, pt, de, ja, ar, hi, it | PCM, WAV, MP3, μ-law, Ogg Opus, WebM Opus | None |
| `mist-v3` | en, es, fr, de | Same as Coda | Pauses, span speeds; phonemes only in English |
| `mist-v2` | en, es, fr, de | PCM, MP3, μ-law | Pauses, span speeds, phonemes; normalization bypass |

Model is required and mapped explicitly to native `coda`, `mistv3`, or `mistv2`.
Never rely on Rime's omitted/unrecognized-model fallback (Mist v3). Language
defaults to `en`, not automatic detection: the chosen voice must support that
language and model. Mist v2 maps these normalized codes to its documented legacy
wire codes (`eng`, `spa`, `fra`, `ger`). Catalog and provisioned custom voices use the same `voice`
field. Clone creation is an enterprise provisioning process, not a synthesis
reference-audio option.

Output defaults to PCM: 24 kHz for modern models and 16 kHz for Mist v2. Rime's
`audio/L16` means **little-endian**, despite the usual MIME convention. Modern
sample rates are positive safe integers. Mist v2 rates are 4000–44100; MP3
defaults to 22050 and μ-law to 8000. Defaults are sent explicitly, so HTTP and
WebSocket do not silently choose different rates. PCM/WAV sample representation
is signed 16-bit LE, not float32. Formats are separate from sample rate.

`speed` is a multiplier, higher being faster. It maps to reciprocal
`timeScaleFactor` on modern models and reciprocal `speedAlpha` on Mist v2.
Modern speed is 0.4–2.5; values outside that range are rejected by the generated
validator instead of silently clamped. Mist v2 accepts positive speed whose
reciprocal can be represented finitely. Defaults are 1.

`textMarkup` groups opt-in interpretation of native inline syntax:

```ts
{
  model: "mist-v3",
  language: "en",
  voice: "cove",
  text: "Hi. <200> Say {k1Ast0xm} [quickly].",
  textMarkup: { pauses: true, phonemes: true, speeds: [2] },
}
```

`pauses` enables `<milliseconds>`, `phonemes` enables Rime phonetic strings in
`{...}`, and `speeds` gives positive speed multipliers for successive `[...]`
spans. Speeds map reciprocally to the comma-separated native `inlineSpeedAlpha`.
This is not SSML, IPA, or an adapter-side parser. General `textNormalization`
is independent, defaults to true, and can only be changed on Mist v2. The schema
rejects unsupported model/language combinations before network work. Per-stream
text-frame limits and finite reciprocal conversion checks remain protocol checks;
current schema annotations cannot bound an iterable's string items or require a
strictly positive finite reciprocal for numeric array entries. Whole-text length
is checked by generated validation.

## Incremental input and interruption

```ts
async function* text() {
  yield "Hello ";
  yield "there.";
  yield { command: "flush" } as const;
  yield { command: "clear" } as const;
  yield "Let's start again.";
}

const stream = synthesize("rime", {
  model: "coda", voice: "astra", text: text(),
  segmentation: "manual", timestampGranularity: "word",
});
```

`sentence` (default), `immediate`, and `manual` map to native `bySentence`,
`immediate`, and `never`. Text frames are sent as supplied without look-ahead;
empty strings are skipped. Whole text and each WebSocket text frame are limited
to 1000 Unicode code points. Input completion sends `eos`, which flushes remaining
text and closes the connection. Empty EOS may close without any audio or native
done event. Successful completion requires clean closure after EOS; a native
done alone cannot complete this iterator.

`flush` sends the native operation immediately. Empty flush produces no response;
busy flushes may coalesce. Native done becomes `{ event: "batch", inputGroupId? }`,
never a fabricated one-to-one flush acknowledgment. Intermediate sentence
boundaries do not necessarily produce native done. The final SDK
`{ event: "done" }` follows clean EOS closure, not the first completed batch.

**Native clear only discards unsent buffered text.** It does not cancel generation
already in flight or text queued by an earlier flush. The adapter also emits a
local playback-clear event and drops subsequent audio/timestamps/batch events
whose echoed context ID belongs to an older clear generation. This filtering is
only as strong as Rime's native context labeling; it is not a server cancellation
acknowledgment or proof that all preceding synthesis stopped. Unlabeled responses
after clear fail rather than being guessed fresh. For a hard stop, abort the
operation and start a new synthesis connection. There is no undocumented session
update/replacement operation.

`signal` and `timeoutMs` cover connection, producer waits and output reads. Abort,
protocol failure and consumer return release the connection and return unfinished
input once, without waiting forever for an uncooperative producer. HTTP responses
are canceled on early exit, errors or deadlines. No automatic retry can duplicate
speech or resume an ambiguous native batch.

## Timestamps: preserve uncertainty

Rime emits word timestamps only for English/Spanish. Other languages cannot request
them in the normalized type. Socket audio never waits for timestamp arrival.

Audio and timestamp events arrive independently. Envelopes use `correlation:
"ordered"`, `inputGroupId` for the echoed context label, and `timestampOrigin:
"synthesis"`. Seconds become milliseconds without accumulation or guessed offsets.
Native timestamps restart for each synthesis, but the protocol does not identify
every synthesis boundary; context IDs are mutable input labels, not unique
segment IDs. Consequently these values **cannot be placed on a global playback
timeline automatically**. No `correlationId`, audio time range, or chunk pairing
is invented from event order. Repeated timestamp origins are preserved even when
no native done separates them.

## Python

`speechswitch.providers.rime.synthesize` implements the same HTTP and JSON
WebSocket protocols. Request types, input validation and output envelopes are
generated from the canonical TypeScript schema; they are not independently
authored Python definitions. Go and Rust use the same generated contracts on
this provider branch.

```python
from speechswitch.providers.rime import synthesize

async def speak():
    async with synthesize({
        "model": "coda", "voice": "astra", "text": "Hello from Rime.",
        "segmentation": "manual", "timestamp_granularity": "word",
    }, timeout_ms=30_000) as stream:
        async for item in stream:
            # Consume audio, independent timestamps, batch and completion events.
            print(item)
```

Python uses native asyncio WebSockets with header auth, without third-party
runtime dependencies. Whole-text HTTP requires `transport: HttpTransport`; its
implementation must return at headers, reject redirects and release in-flight
requests on cancellation. Supply `auth={"rime": {"api_key": "…"}}` or the same
scoped/legacy environment variables as TypeScript. Socket overrides use
`web_socket`; endpoint overrides use `base_url` and `web_socket_url`.

Always use `async with`: leaving it closes an unread socket override, an active
response, or an unfinished stream. `timeout_ms` covers connection, producer waits,
reads and consumer backpressure. Cancellation does not wait for an input producer
that ignores cancellation. `max_message_bytes` defaults to 4 MiB and bounds encoded
socket writes and received messages, including injected transports. Incremental
text still has the native per-frame limit of 1000 Unicode code points, not a
connection-wide text limit. Local clear, native batch, synthesis-local timestamps
and clean-EOS completion follow the semantics above.

Shared TypeScript/Python fixtures cover model-specific request conversion and
malformed frames. Python tests also exercise native loopback WebSocket auth,
fragmented frames, early/abnormal close, ambiguous clear labels, backpressured
writes, bounded input, cancellation at HTTP headers/body and producer waits,
deadlines during consumption, and exact compiler diagnostics for invalid model
combinations. No credentialed live inference was performed.

## Go

`sdks/go/providers/rime.Synthesize` implements the same byte-native HTTP and JSON
WebSocket protocols. Its request, input-item, validator and output types come
from `sdks/go/generated/rime` and `rime_output`, generated from TypeScript.
There is no reflection-based request conversion or separate handwritten schema.

```go
import (
    "context"
    "io"

    schema "github.com/speechswitch/client/sdks/go/generated/rime"
    "github.com/speechswitch/client/sdks/go/providers/rime"
)

func speak(ctx context.Context) error {
    request := schema.TtsRequestAsCodaTextVoicef75e9756{
        Value: schema.TtsRequestCodaTextVoicef75e9756{
            Voice: "astra", Text: "Hello from Rime.",
        },
    }
    stream, err := rime.Synthesize(ctx, request, rime.Options{})
    if err != nil { return err }
    defer stream.Close()
    for {
        item, err := stream.Next(ctx)
        if err == io.EOF { return nil }
        if err != nil { return err }
        _ = item // Consume bytes or the generated output variant.
    }
}
```

Model/language-specific request branches and optional fields remain explicit in
the generated Go types. Both generated value and pointer wrappers are accepted.
Whole text defaults to HTTP. Incremental input, timestamp requests, explicit
segmentation, `WebSocket` or `WebSocketURL` select JSON WebSockets. The native
transports use header auth; HTTP rejects redirects and sockets use `/ws3` by
default. Existing enterprise voices remain ordinary voice IDs.

`Options.Auth` uses the shared generated auth object, with the same scoped/legacy
environment fallbacks as TypeScript and Python. `Transport`, `WebSocket`,
`BaseURL` and `WebSocketURL` are injectable. A socket override is already
authenticated and query-configured, exclusively owned and closed even if unread.
HTTP transport overrides must preserve cancellation/credential ownership and
reject redirects; the SDK's native HTTP transport already does so.

`Synthesize` validates and resolves configuration before any I/O. The first
`Next` starts network work. Always call `Close`; the operation context and
`TimeoutMs` cover idle consumer time too. Canceling an active `Next` context also
cancels the whole operation. `TimeoutMs` uses `runtime.Optional[int64]`, so zero is an immediate
deadline rather than omission. `MaxMessageBytes` defaults to 4 MiB when zero.
The operation releases its resources before returning final done/error; producer
cleanup is detached if application input code refuses to stop. Socket reads
remain active while a write is backpressured, without pulling ahead on input.

Go tests cover shared wire fixtures, every request branch in both pointer/value
forms, native HTTP/WebSocket auth and proxy paths, fragmented socket responses,
redirect/handshake rejection, independent timestamp origins, clear/batch/EOS,
message/text limits, cancellation and uncooperative producers. Race-detector
runs and exact negative compiler diagnostics check lifecycle and type narrowing.

## Rust

`speechswitch_types::providers::rime::synthesize` implements byte-native HTTP and
JSON WebSockets with generated `rime::TtsRequest` and `rime_output::SynthesisItem`.
The provider re-exports both types. Model/language-specific variants remain
explicit; the generated validator runs before I/O and validates incremental items.

Set `Options.transport` to `Some(&http_backend)` for HTTP or
`Options.web_socket_transport` to `Some(&socket_backend)` for native WebSockets.
The backends implement `HttpTransport` and `WebSocketTransport`, respectively.
The provider creates the socket through that backend, resolving the `/ws3` URL,
query parameters, header authentication and message limit at its public boundary.
The backend must supply OS entropy and enforce its transport contract, including
cancel-on-drop, HTTP redirect rejection and abnormal-close errors. An exclusively
owned `web_socket` override is already authenticated/query-configured and also
requires an `entropy` source. Auth and endpoint defaults match TypeScript.

The crate adds no networking dependency, TLS implementation or executor. The host
provides those backends and enforces whole-operation deadlines by dropping the
future or stream. Dropping even an unpolled synthesis future releases its owned
request and socket override. The returned stream owns its resources, outlives the
configuration/backend references, and releases resources before yielding final
done/error. Poll through `runtime::InputStream`; consumer buffering is explicit.

Input polling and socket receives alternate without input lookahead; reads remain
active while a write is backpressured. Each poll does bounded protocol work and
registers or wakes the task for further progress. Native batch events cannot end
the connection; completion requires input EOS, a successful EOS write and a clean
close. Clear filtering preserves the native limitations described above, and
timestamp origins are never accumulated into an inferred playback timeline.

Rust tests cover every model/language branch with both whole and incremental text,
shared request/error fixtures, exact compiler diagnostic codes and source lines,
header/query construction, pending handshake/HTTP body ownership, clear/batch/EOS,
Unicode and message limits, backpressure and concrete transport-error identity.
Tests use injected native-backend doubles, not live provider calls or a bundled
Rust network client. All three foreign adapters are implemented on this branch.

## Why no wire codegen?

Thirty-five unchanged source snapshots are cataloged with URL, GET method and
SHA-256. The embedded Mintlify endpoint objects have empty response contracts;
WebSocket connection parameters are misclassified as a GET JSON body. Model,
language, format and speed constraints are prose, not codified enums/bounds.
Mist v3's structured socket record omits both preferred `timeScaleFactor` and
English phoneme support. The MCP wrapper is not a substitute underlying contract.
`sources.test.ts` asserts these findings on the raw snapshots without executing
the embedded MDX. Only our authored normalized schema drives request validation,
registry/spec output, and Rust/Python/Go request-type generation.

Rechecked all 35 upstream GET URLs on 2026-09-07 at 13:18 UTC, following redirects
and rejecting non-2xx responses. All 21 Markdown/discovery bodies matched their
cataloged hashes. The 14 rendered HTML bodies changed, but a second read at
13:27 UTC confirmed each embedded endpoint object is identical to its cataloged
snapshot. The existing raw snapshots are retained unchanged; this is not a claim
that today's rendered HTML hashes match them. The contract gaps above remain.

Current feature guides take precedence over inconsistent legacy reference text:

- [WebSocket overview](https://docs.rime.ai/docs/websockets) and
  [streaming guide](https://docs.rime.ai/docs/streaming) recommend `/ws3` for all
  models, including Mist v2. The overview's trailing link table still points
  Mist v2 to legacy `/ws2`; an explicit socket URL can select that compatible
  JSON endpoint, but it is not the default.
- [Segmentation guide](https://docs.rime.ai/docs/websockets-segment) explains empty
  and coalesced flushes and the limited scope of native clear.
- [Pronunciation guide](https://docs.rime.ai/docs/custom-pronunciation) and
  [normalization guide](https://docs.rime.ai/docs/text-normalization) document
  English Mist v3 phonemes, which older model tables omit.
- [Speed guide](https://docs.rime.ai/docs/speed) distinguishes modern preferred
  time scaling from compatibility speedAlpha and per-span legacy direction.
- [Voice cloning](https://docs.rime.ai/platform/voice-cloning) documents existing
  UUID voice selection without a reference-audio synthesis field.

Legacy raw WebSocket, Mist v2 SSE and buffered JSON endpoints are preserved as
research snapshots, not exposed as additional synthesis operations. This PR
covers the issue's preferred HTTP and JSON WebSocket transports, without adding
slower alternatives or pretending legacy-only formats work on the preferred API.

Tests cover generated validation/model narrowing, unchanged-source hashes,
playground defaults, all documented preferred formats, native Node HTTP and
WebSocket auth, independent timestamps, coalesced/empty flushes, clear filtering,
malformed frames and cancellation cleanup. No live credentialed synthesis was
performed; protocol behavior is exercised using injected transports and loopback
servers.
