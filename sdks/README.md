# Rust, Python and Go foundation

`schemas/` remains the only authored API definition. TypeScript 7 normalizes those
types and validates provider subsets before the Rust, Python and Go emitters run.
There is no OpenAPI detour or parallel hand-maintained request schema.

```
schemas/base.ts + schemas/providers/*/index.ts
                    |
          checked normalized type graph
              /          |          \
         Rust types  Python types  Go types
```

This is a **type and streaming-runtime foundation, not three complete synthesis
SDKs**. The generated modules cover the base request and every integrated
provider. A handwritten byte-native HTTP runtime now handles incremental reads
and response ownership in each language. Shared output envelopes and control events
are generated from the same runtime-free schema project. Python, Go and Rust have
handwritten Mistral and Async provider ports. All three also have CAMB adapters
backed by generated wire types, checks and HTTP clients. Python and Go supply native
WebSocket transports; Rust uses an injected native backend. Other foreign
provider coverage is partial: Cartesia now has handwritten ports in all three
languages. All three languages have
generated executable request and input-item validators for every provider.
Do not serialize these structs directly as provider wire requests or treat type
checking as validation of external data.

## Layout and generation

- `sdks/rust`: dependency-free `speechswitch-types` crate and injected HTTP runtime.
- `sdks/python`: Python 3.13+ typed package and asyncio transport contracts.
- `sdks/go`: dependency-free Go module with separate provider packages.
- `codegen/language-types.ts`: emitters consuming the normalized graph, never
  TypeScript's printed type strings.

Run `bun run generate:languages` after changing the canonical schemas. Generated
files must not be edited by hand. `bun run verify:languages` is part of the normal
repository check; it also detects obsolete provider files without deleting them.

Fields use snake_case in Rust/Python and exported PascalCase in Go. Comments retain
the original TypeScript field name, documentation, bounds and omission defaults.
Name collisions fail generation. Anonymous variant names use model/input labels,
with deterministic suffixes where necessary; documentation-only edits do not
rename them. Python's reserved `async` provider is imported as `async_` (likewise
for the Rust module and Go package).

Python's extra absent-base-field padding affects type checking, but not provider
variant names: adding a shared field must not rename unrelated provider APIs.

## Type semantics

| Concept | Rust | Python | Go |
| --- | --- | --- | --- |
| Provider/model alternatives | Enums with variant structs | Read-only TypedDict unions | Sealed interfaces with variant wrappers |
| Exact scalar choice | Singleton value types | Literal; singleton float-backed Enum for fractional values | Singleton value types |
| Omitted property | Option | NotRequired, without adding None | Optional with explicit presence |
| Explicit null | Separate null variant | None only where authored | Separate null variant |
| Audio bytes | Vec of u8 | bytes | byte slice |
| String-keyed records | BTreeMap | Mapping | map |
| Recursive JSON data | JsonValue enum | Recursive JSON alias | Sealed JsonValue interface |
| Streaming input | Poll-based InputStream | AsyncIterable | Context-aware Input.Next and Close |
| Unbounded integer | Decimal BigInt value | int | math/big.Int |

Forbidden fields do not appear in Rust/Go structs. Python emits
`ReadOnly[NotRequired[Never]]`, including unsupported base fields, so open TypedDict
extra-key semantics do not weaken provider-to-base assignment. Array elements and
required fields never acquire optionality just because another field is optional.

Defaults are documented, not inserted by these types. A present zero/false/null
remains distinct from omission. Generated validators enforce numeric bounds and
ECMAScript patterns in all three languages. Go zero values
can contain missing required interfaces; Python typing is not a runtime validator;
Rust f64 permits non-finite values. Type checking alone does not make a validated
synthesis request.

Input primitives support incremental consumption and failure without an executor
dependency. Go producers must honor their context and Close; Rust producers must
register a waker and avoid blocking poll_next. The provider layer will own
incremental input cancellation and cleanup. These contracts do
not claim that arbitrary uncooperative producers can be forcibly canceled.

## Streaming HTTP runtime

The runtime takes a fully constructed wire request, not a normalized `TtsRequest`.
Provider adapters will resolve shared authentication, environment values, defaults
and generated validation before constructing it. There is no second authored
request schema and no generated vendor client for an incomplete upstream contract.

| Language | HTTP implementation | Early exit / cancellation |
| --- | --- | --- |
| Rust | Inject `http::HttpTransport`; HTTP/TLS and executor are supplied by the application | Drop the open future or `AudioStream` |
| Python | Inject `speechswitch.http.HttpTransport`; no blocking network work is introduced into asyncio | Use `async with open_audio(...)`; task cancellation propagates to send/read |
| Go | Pass `*http.Client` or another `runtime.HTTPTransport` | `defer audio.Close()`; request context or `Next` context cancellation stops the response |

The audio helpers return raw byte chunks without collecting the response, decoding
base64, or guessing timestamp association. It closes non-2xx responses without
reading their potentially unbounded or sensitive error bodies. EOF and read
errors release the body immediately. Empty chunks are not EOF; bytes returned
alongside a Go read error are delivered before the error. Consumers own returned
chunks; later reads do not overwrite them.

Go's `OpenResponse` exposes headers and status with the same owned byte stream,
without interpreting them. Provider adapters use it to frame SSE/JSON and read
bounded error bodies; `OpenAudio` retains its non-2xx rejection behavior.

Python requires the context manager even if an `async for` loop exits early.
Use a single reader and cancel its task before closing from elsewhere. Rust
transports must implement cancellation through resource ownership; a dropped
future/body must release the request. Go response bodies must unblock `Read`
when closed, as native `net/http` bodies do. Injected transports must not buffer
the complete response or forward credentials across origins on redirects.

These are **consumer-side cancellation** guarantees, not provider-side barge-in.
Native `clear` commands, acknowledgments, stale-audio suppression, incremental
text and timestamp envelopes still belong in each provider's protocol adapter.
JSON/SSE/WebSocket response framing must not be passed off as raw audio.

## Incremental SSE decoding

Dependency-free SSE data-event decoders are available in Rust `sse::Decoder`,
Python `speechswitch.sse.SseDecoder`, and Go `runtime.SSEDecoder`. They return
`SseMessage`, generated in each language's `transport` module from
`schemas/transport.ts`. TypeScript's existing import remains compatible.

Feed each HTTP chunk's bytes to `push` / `Push` in order, processing any returned
message before reading further. This avoids a second per-chunk event queue and
delivers a completed CR-delimited event without waiting for another network read.
The decoder never pulls input or owns the response: keep the HTTP context manager,
deferred close or Rust resource owner around the entire parsing loop.

Construct it with an explicit positive `max_event_bytes` limit. It counts raw
bytes in each block, including comments, unknown fields and a leading BOM, with
line endings normalized to one byte and the blank separator excluded. The limit
is a framing resource bound, not a generated request-schema constraint. Oversize
input terminates the decoder; no error includes response content. Call `finish`
/ `Finish` at EOF or consumer exit to discard unfinished data and release buffers.

For example, inside Python's existing `async with open_audio(...) as body`:

```python
decoder = SseDecoder(max_event_bytes=4 * 1024 * 1024)
try:
    async for chunk in body:
        for byte in chunk:
            message = decoder.push(byte)
            if message is not None:
                # Decode this provider's JSON/protocol here, not in the framer.
                consume(message)
finally:
    decoder.finish()
```

Framing follows the [WHATWG SSE parsing rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream):
UTF-8 replacement decoding, one initial BOM, CR/LF/CRLF, multiline data, exact
field names, one-space removal, and dispatch only at a blank line. Empty `data`
fields are real events; comment/event-only blocks are not. This is deliberately
not an `EventSource` implementation: `id` and `retry` are ignored, connections are
never retried, and `[DONE]`, error events, base64, JSON and timestamp correlation
have no special meaning to the framer. HTTP EOF is not provider completion.

All four languages use `sdks/fixtures/sse.json` for framing goldens. Rust's check
compiles those fixtures into a temporary test harness without a JSON dependency.
The suite tests every two-chunk split plus empty chunks, malformed Unicode,
truncated blocks, exact limits and terminal errors. These tests also caught and
fixed TypeScript's runtime-dependent BOM handling and unnecessary CR lookahead.

## Shared output contracts

`schemas/timestamps.ts` owns the timestamp/envelope definitions, and
`schemas/stream.ts` owns shared events and concrete stream types. Existing
TypeScript exports from `sdk/timestamps.ts`, `sdk/dispatch.ts` and `sdk/index.ts`
remain compatible. `schemas/base.ts` still describes shared request/output-format
fields, without a union of provider/model combinations.

The generated `stream` module is available as:

- Rust: `speechswitch_types::generated::stream`
- Python: `speechswitch.generated.stream`
- Go: `github.com/speechswitch/client/sdks/go/generated/stream`

It exports `Timestamp`, `SynthesisEnvelope`, `ClearEvent`, `FlushEvent`,
`UpdatedEvent`, `DoneEvent`, `BatchEvent`, `AudioStreamItem`, `TimestampStreamItem`, `AudioStream`
and `TimestampStream`. Audio uses native bytes, not base64. A chunk envelope
requires audio; ordered/timeline envelopes may contain timestamps without audio.
Native correlation IDs, input grouping, timeline offsets, audio time ranges and
replacement updates remain explicit. No code pairs timestamps with audio by
arrival order. Present empty replacement arrays, false settings and zero offsets
remain distinct from omission.

Rime adds `BatchEvent` for a native synthesis run that is neither a one-to-one
flush acknowledgment nor stream completion. Its `timestampOrigin: "synthesis"`
retains local timestamps when the protocol omits complete synthesis-boundary IDs;
consumers must not reinterpret these as full-stream playback offsets.

These are shared transport contracts, not a claim that every provider supports
every event. Provider-specific usage and completion fields still belong to future
provider output ports; the shared done event does not erase or standardize them.
Likewise, a clear event's type does not promise native cancellation or an
acknowledgment. Those semantics remain each protocol adapter's responsibility.
There are no new runtime dependencies or runtime schema interpreters.

Foreign stream aliases use the existing pull-based runtime contracts. They do not
add a buffering layer or consume input during type generation. Python TypedDict
checking and Go sealed interfaces are not runtime validators; Go also permits
missing required fields through zero values. Generated request/output validators
are still necessary at future provider boundaries; all three languages' request/input checks
are now available, but output validation is not yet generated.

## Python request validation

```python
from speechswitch.generated.validators.xai import validate_request

check_item = validate_request(request)
# Once the adapter consumes a text value or command:
check_item(item)
```

The validator consumes the same independently normalized provider graph as the
TypeScript validator. It emits specialized checks, not schema descriptors or
a runtime schema interpreter. Fields use the same snake_case names as the Python
types. Request validation neither acquires an async iterator nor inserts defaults;
the returned checker validates each consumed item against the matching request
variants. Providers with named inputs can pass that field as the second argument.
An audio-only/static input has no accepted stream items.
For a field accepting either static data or an async iterable, only an actual
iterable enables item validation, not merely membership in that request variant.

Checks cover literals, forbidden fields, optional versus explicit-null fields,
finite numbers, safe integers, bounds, collection lengths, Unicode code-point
limits, bytes, string-keyed mappings and recursive JSON values. Booleans do not
pass as numbers despite Python's subclass relationship. JSON validation rejects
cycles while permitting repeated references and uses an explicit traversal stack.
Unknown extra object fields remain allowed unless explicitly forbidden by the
authored schema, matching TypeScript's validator policy.

Python errors accumulate sibling and element failures using canonical TypeScript
field paths (for example `request["sampleRateHz"]`), even though the input key is
`sample_rate_hz`. Failed union alternatives remain in the diagnostic only if no
alternative succeeds. Each streamed item gets a fresh error buffer. The parity
suite compares complete Python/TypeScript error messages, not substrings or just
accept/reject results. Collection checks use indexed access so custom iterators
cannot change which elements are validated.

Flag-free ECMAScript patterns are translated at generation time and compiled with
Python's standard library. Matching uses UTF-16 units, exact ECMAScript whitespace,
and strict end anchors; `maxLength` separately counts Unicode code points. The
supported syntax includes character classes/ranges, alternation, groups,
quantifiers and lookahead. Backreferences, lookbehind and other unsupported syntax
fail generation rather than silently weakening a constraint. All current schema
patterns are supported. Pattern results are checked against Node's RegExp engine,
including surrogate pairs, lone surrogates, line endings and boundary lengths.
See the [ECMAScript assertion semantics](https://tc39.es/ecma262/multipage/text-processing.html#sec-compileassertion).

These checks validate Python data, not provider wire JSON. Provider adapters must
still resolve configuration/defaults and explicitly convert normalized requests.
No foreign provider synthesis boundary has been added by this validation layer.

## Go request validation

```go
checkItem, err := xai.ValidateRequest(request)
if err != nil {
    return err
}
// Once the adapter consumes a generated text/command union value:
if err := checkItem(item); err != nil {
    return err
}
```

Every generated provider package exports `ValidateRequest`. It checks the concrete
generated representation, including bounds, finite numbers, safe integers,
collection lengths, patterns and recursive JSON. Literal choices and forbidden
fields are enforced by the generated types; union values use those same wrappers,
including when passed to the item checker. Amazon's string-only input does not
accept xAI commands. An optional second argument selects the canonical input field
name, such as `"turns"`.

On failure, generated functions project request data into canonical field names
and run specialized diagnostic checks across union alternatives. The projection
contains values, not runtime schema descriptors; public requests stay concrete.
Errors accumulate sibling and element failures, discarding failed alternatives
when another succeeds. Record keys are sorted for deterministic Go diagnostics
(TypeScript and Python retain their object insertion order). Input errors use a
fresh buffer on every call and never include scalar request values.

Validation neither calls `Next`/`Close` nor inserts defaults. Only the actual
streaming field variant enables its item checker. Missing interfaces and typed-nil
union wrappers/producers are rejected. Nil slices/maps represent empty collections;
explicit JSON null uses `runtime.JsonNull{}`. Recursive JSON checks reject cycles
but permit shared children and traverse without recursive calls.

Go strings and record keys must be valid UTF-8. Pattern matching then uses UTF-16
units, while `maxLength` counts Unicode code points, matching the canonical
TypeScript constraints. The generator compiles the same supported ECMAScript
pattern grammar as Python into fixed Go matcher functions: no runtime pattern
descriptors, regex interpreter or external dependencies. Pattern parity separately
tests lone UTF-16 surrogates even though they cannot occur in a valid Go string.

`bun run check:languages` compiles all three languages and checks exact expected
type errors. It also compares complete Go/Python error messages against TypeScript;
the Go suite currently covers 27 providers, 18,573 typed request cases and 15,714
pattern cases. Focused runtime tests cover typed nils, JSON cycles, non-finite
numbers, Unicode and input narrowing. These are normalized request checks, not
wire codecs or provider synthesis implementations.

## Rust request validation

```rust
use speechswitch_types::generated::validators::xai::validate_request;

let check_item = validate_request(&request)?;
// Move/destructure request here when the adapter takes ownership of its stream.
check_item(&item, None)?;
// Named inputs use the canonical field name: check_item(&item, Some("turns"))?.
```

Each provider has its own module under `generated::validators`. Validation borrows
the concrete generated request temporarily and returns a checker that owns only
input-selection flags. It neither acquires, polls nor drops the producer, and does
not insert defaults. The caller can move the request immediately afterward. Pass
the generated input enum value (or a `String` for string-only inputs); the checker
rejects values of the wrong Rust type, invalid item bounds and inactive input
fields. Use `None` for `text`, or `Some(field)` for a named input.

Rust types already enforce literal choices, forbidden fields, valid UTF-8,
explicit-null variants and required field presence. Generated predicates check the
remaining numeric, string, collection and recursive-JSON constraints. The owned
JSON representation cannot contain cycles; an iterative traversal checks nested
numbers for finiteness. Pattern functions are generated from the same canonical
UTF-16 grammar as Go, without external dependencies or a runtime interpreter.

Failed requests use generated, borrowed data projections and specialized checks
to report all applicable failures with canonical TypeScript field paths. No
schema descriptors are emitted, and successful requests need no projection.
`ValidationError` owns its diagnostic string. As in Go, record keys follow sorted
order; successful alternatives discard earlier failures and consumed items never
reuse a previous error buffer.

The Rust/TypeScript differential suite compares full errors for all 27 providers with 17,519 typed
request cases and 15,714 regex cases, including direct UTF-16 matcher inputs that
Rust strings cannot represent. The combined language check also tests ownership,
provider input narrowing, exact errors, nullable fields, bytes and unbounded
integers. Existing generated request type declarations remain unchanged; this
layer does not yet add Rust provider synthesis adapters or wire codecs.

## Python Mistral provider

```python
from speechswitch.providers.mistral import synthesize

async with synthesize(
    {"text": "Hello", "voice": "existing-custom-voice"},
    transport=transport,
    auth={"mistral": {"api_key": "..."}},
) as stream:
    async for item in stream:
        if isinstance(item, bytes):
            play(item)
        else:
            handle_done(item)  # Preserves native usage when SSE supplies it.
```

Supply an async `HttpTransport` that returns at headers and honors cancellation;
there is no third-party HTTP dependency or hidden blocking network client. The
context manager releases the response on completion, errors, cancellation and
early loop exit. `timeout_ms` covers the whole context. SSE events and buffered
JSON/error bodies have separate positive byte limits (`max_event_bytes`, default
4 MiB; `max_json_bytes`, default 16 MiB).

The adapter requests SSE and accepts JSON fallback, decodes only the protocol's
base64 audio, and requires native `speech.audio.done` after nonempty SSE audio.
It preserves all five output formats, existing voice IDs, independent reference
audio, metadata, prompt cache keys and optional/null usage details. Whole text is
the only supported input; there are no fabricated timestamps or barge-in commands.
Auth resolves explicit `auth.mistral.api_key`, then
`SPEECHSWITCH_MISTRAL_API_KEY`, then `MISTRAL_API_KEY`; an explicit empty key fails.

Shared auth is now authored in `schemas/auth.ts`, with existing TypeScript imports
preserved through `sdk/auth.ts`. Mistral output types also live in its canonical
provider schema. Both are generated for all three foreign languages; no separate
handwritten foreign API types were introduced. The provider uses generated request
validation and unconditional model defaults. Its wire protocol remains handwritten
because the cataloged upstream contracts are incomplete. Shared transport fixtures
in `sdks/fixtures/mistral.json` run against TypeScript, Python, Go and Rust on this
provider branch.

## Go Mistral provider

```go
import (
    "context"
    "io"

    schema "github.com/speechswitch/client/sdks/go/generated/mistral"
    output "github.com/speechswitch/client/sdks/go/generated/mistral_output"
    "github.com/speechswitch/client/sdks/go/providers/mistral"
    "github.com/speechswitch/client/sdks/go/runtime"
)

func speak(ctx context.Context, play func([]byte), handleDone func(output.DoneEvent)) error {
    stream, err := mistral.Synthesize(ctx, schema.TtsRequest{
        Text: "Hello",
        Voice: runtime.Some("existing-custom-voice"),
    }, mistral.Options{}) // Uses SPEECHSWITCH_MISTRAL_API_KEY or MISTRAL_API_KEY.
    if err != nil {
        return err
    }
    defer stream.Close()
    for {
        item, err := stream.Next(ctx)
        if err == io.EOF {
            return nil
        }
        if err != nil {
            return err
        }
        switch item := item.(type) {
        case output.SynthesisItemAsBytes:
            play(item.Value)
        case output.SynthesisItemAsDone:
            handleDone(item.Value)
        }
    }
}
```

The Go adapter uses the same canonical generated request, auth and output types,
generated request validator, and handwritten protocol as the Python port above.
Native `net/http` is the default transport, with redirects disabled; `Options.Transport`
accepts an injected `runtime.HTTPTransport`. `Options.Auth` accepts the shared Auth
object and has the same explicit-key/environment precedence as Python.

Always defer `Close`, including when no item is consumed. Request cancellation,
`Next` cancellation, native completion and read errors release the response.
`Options.Timeout` is an optional whole-stream `time.Duration`; omission has no
deadline, and `runtime.Some(time.Duration(0))` expires before network access.
The deadline also releases the body between pulls. `MaxEventBytes` and
`MaxJSONBytes` default to 4 MiB and 16 MiB when zero; negative values are rejected.
An HTTP failure returns `*mistral.Error` with status, opaque body and optional
Retry-After separately; its message does not print response content.

Shared fixture tests check every byte split and exact output/error values.
Additional race-enabled tests exercise native HTTP cleanup, deadlines, redirects,
generated rejection before network access and independent voice/reference audio.

## Rust Mistral provider

```rust
use speechswitch_types::{
    generated::{mistral::TtsRequest, mistral_output::{DoneEvent, SynthesisItem}},
    http::{HttpTransport, TransportError},
    providers::mistral::{synthesize, Options},
    runtime::InputStream,
};
use std::{future::poll_fn, pin::Pin};

async fn speak(
    transport: &dyn HttpTransport,
    mut play: impl FnMut(Vec<u8>),
    mut handle_done: impl FnMut(DoneEvent),
) -> Result<(), TransportError> {
    let request = TtsRequest {
        text: "Hello".into(), voice: Some("existing-custom-voice".into()),
        model: None, output: None, reference_audio: None,
        metadata: None, prompt_cache_key: None,
    };
    let mut stream = synthesize(&request, transport, Options::default()).await?;
    while let Some(item) = poll_fn(|cx| Pin::new(&mut stream).poll_next(cx)).await {
        match item? {
            SynthesisItem::Bytes(bytes) => play(bytes),
            SynthesisItem::Done(event) => handle_done(event),
        }
    }
    Ok(())
}
```

Supply an application-owned HTTP/TLS transport and executor; the SDK has no
third-party runtime dependencies. Generated requests, shared `Auth`, output types
and validation remain derived from TypeScript. `Options.auth` borrows that shared
auth object, with the same explicit/scoped/native environment precedence as the
other ports. Local JSON and base64 codecs handle the wire format; JSON scanning
and writing use explicit stacks instead of recursive parser calls.
The language check also compares Rust JSON syntax and decoded strings against
Node's `JSON.parse`, including mutated inputs, controls and surrogate escapes.

Dropping the pending synthesis future cancels its send. Dropping the returned
stream cancels its response, including unread and pending bodies. Completion and
errors release the body before returning their event/error. `Options.timeout`
accepts an optional `Duration`: zero fails before network access. Each explicit
timeout uses one interruptible timer thread, canceled when the stream/future is
dropped or completed. It wakes pending sends and drops idle response bodies even
between consumer polls. As with every Rust future, an awakened pending send must
be polled by the executor to observe its deadline and drop its transport future.

SSE events and accumulated JSON/error bodies have separate positive byte limits,
defaulting to 4 MiB and 16 MiB. The adapter preserves all five formats, JSON fallback,
saved voices, independent reference audio, metadata, cache keys and native usage
nullability. Shared fixtures run at every byte split; additional tests cover drop,
deadlines, opaque HTTP failures, read-error identity, auth precedence and generated
pre-network rejection. Cancellation is resource ownership, not a fabricated
provider-side clear command.

## Python Async provider

```python
from speechswitch.providers.async_ import synthesize

async def text():
    yield "Hello "
    yield "from the next token."

async with synthesize(
    {
        "model": "flash_v1.5", "voice": "existing-custom-voice",
        "text": text(), "output": {"format": "pcm", "sample_rate_hz": 24000},
        "segmentation": "immediate",
    },
    auth={"async_": {"api_key": "..."}},
) as stream:
    async for audio in stream:
        play(audio)
```

Whole-text requests take an injected `transport=HttpTransport`, using the native
HTTP streaming route except for WAV and word timestamps. Incremental text creates
a native asyncio WebSocket at the provider boundary; `web_socket=WebSocketLike`
is an already-connected test/runtime override. The adapter implements all three
HTTP routes, split quota-marker detection, model-specific settings, existing
voice IDs, incremental contexts, forced segmentation and native completion.
It does not invent clear commands, acknowledgments or timestamp correlations.

`timestamp_granularity="word"` returns the generated `async_output.TimestampedAudio`
with `correlation="chunk"`: its audio and word times belong to the same native
response. Canonical `WordTimestamp`, `TimestampedAudio` and `SynthesisItem` are
authored in the Async TypeScript schema and generated for Python, Go and Rust.
The base request/output shapes remain free of provider-variant unions.

Auth resolves explicit `auth.async_.api_key`, then `SPEECHSWITCH_ASYNC_API_KEY`,
then `ASYNC_API_KEY`. Explicit empty keys fail. Defaults and request/input checking
stay at the public boundary. HTTP error/timestamp bodies are bounded by
`max_json_bytes` (16 MiB); socket messages by `max_message_bytes` (4 MiB), including
injected sockets. Both limits must be positive. Shared HTTP fixtures run against
TypeScript, Python, Go and Rust at every byte split.

Always use the context manager. Consumer exit, failure and cancellation release
the socket/body and stop pending input/output tasks. Injected transports and text
producers must honor cancellation; arbitrary uncooperative Python coroutines
cannot be forcibly stopped. Injected sockets must close idempotently.
One pending write is raced with incoming audio, so backpressure on text sends
cannot stall playback or start additional input pulls.

The dependency-free `speechswitch.websocket.connect_websocket` uses direct
`asyncio` TCP/TLS connections, verifies certificates by default, and accepts native
authorization headers. Its [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455.html)
framing supports masked client messages, fragmented text/binary messages,
interleaved ping/pong, validated close frames and bounded headers/messages.
It does not negotiate compression/extensions/subprotocols, follow redirects, or
discover proxies. One reader and concurrent backpressured sends are supported.
Early close sends a best-effort notification then aborts the transport; it never
waits indefinitely for a peer's close handshake. Loopback tests cover real sockets,
auth headers, framing, invalid responses and cancellation before/after headers.

## Go Async provider

```go
import (
    "context"
    "io"

    schema "github.com/speechswitch/client/sdks/go/generated/async_"
    out "github.com/speechswitch/client/sdks/go/generated/async_output"
    "github.com/speechswitch/client/sdks/go/generated/auth"
    "github.com/speechswitch/client/sdks/go/providers/async"
    "github.com/speechswitch/client/sdks/go/runtime"
)

func speak(ctx context.Context, text runtime.Input[string], play func([]byte)) error {
    request := schema.TtsRequestAsFlashV15StreamingTextVoice{
        Value: schema.TtsRequestFlashV15StreamingTextVoice{
            Text: text, Voice: "existing-custom-voice",
            Output: schema.TtsRequestFlashV15StreamingTextVoiceOutputAsPcm{
                Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputPcm{
                    SampleRateHz: 24000,
                },
            },
        },
    }
    stream, err := async.Synthesize(ctx, request, async.Options{
        Auth: auth.Auth{Async: runtime.Some(auth.AuthAsync{
            ApiKey: runtime.Some("..."),
        })},
    })
    if err != nil { return err }
    defer stream.Close()
    for {
        item, err := stream.Next(ctx)
        if err == io.EOF { return nil }
        if err != nil { return err }
        switch item := item.(type) {
        case out.SynthesisItemAsBytes:
            play(item.Value)
        }
    }
}
```

`async.Synthesize` supports all three HTTP routes and incremental WebSockets with
the same generated model-specific requests and chunk-correlated timestamp output.
It validates before network/input access, resolves shared `Auth.Async.ApiKey`
before the scoped/native environment variables, and creates the native socket at
the public boundary. `Options.Transport` and `Options.WebSocket` are injectable.
Settings, custom voice IDs, output encodings, legacy speed/stability, input
segmentation, native completion and split quota markers match the TS/Python ports.
It does not add clear/done events unsupported by Async.

Successful incremental calls transfer ownership of the input and socket, even if
the stream is never read. Always defer `Close`. Context cancellation releases
resources between consumer pulls too. There is at most one outstanding input
pull, one write and one socket receive; already-ready output takes priority.
Backpressured writes do not block receiving audio or prefetch more input. After yielding
audio, the next socket receive waits for the next consumer pull. Closing releases
the socket before input cleanup; inputs must honor context cancellation and their
`Close` must unblock pending `Next`. Failed validation/auth/handshakes do not pull
or close the caller's input. Returned byte slices are owned by the consumer.

`MaxJSONBytes` and `MaxMessageBytes` default to 16 MiB and 4 MiB when zero; negative
limits fail. Message limits also apply to injected sockets. Native Go WebSockets
use verified TLS and HTTP/1.1 upgrades, with native authentication headers,
masked client framing, fragmentation, ping/pong, strict UTF-8 and close validation.
They do not follow redirects, discover proxies, or negotiate compression,
extensions or subprotocols. `runtime.WebSocketOptions.MaxHeaderBytes` defaults to
64 KiB for native handshakes; transport overrides own raw header limits and must
return a duplex response body after a successful upgrade. `Close` immediately
aborts the connection, including blocked reads/writes; it does not wait for a
graceful peer close handshake. Normal peer close frames are acknowledged while
the receive context is active.

## Rust Async provider

`providers::async_::synthesize(request, Options)` takes ownership of the generated
`async_::TtsRequest` and returns a poll-based `Stream` of generated
`async_output::SynthesisItem`. All nine model/input/timestamp branches retain their
TypeScript schema constraints. The adapter handles all three HTTP routes and the
incremental context protocol, with the same custom voice selection, audio
encodings, legacy speed/stability, segmentation and chunk-correlated word times.
It does not fabricate normalized completion/clear events.

```rust
use speechswitch_types::{
    generated::{async_::TtsRequest, auth::Auth},
    http::{HttpTransport, TransportError},
    providers::async_::{self, Options, Stream},
    websocket::WebSocketTransport,
};

async fn open(
    request: TtsRequest,
    auth: &Auth,
    http: &dyn HttpTransport,
    sockets: &dyn WebSocketTransport,
) -> Result<Stream, TransportError> {
    async_::synthesize(request, Options {
        auth: Some(auth),
        transport: Some(http),
        web_socket_transport: Some(sockets),
        ..Options::default()
    }).await
}
```

Whole text requires `Options.transport`; incremental input requires
`Options.web_socket_transport`. Rust's standard library provides neither async
TLS nor WebSockets, and the crate has no third-party runtime dependencies. These
are explicit native-backend contracts, not a bundled Rust network client.
`WebSocketTransport::connect` receives the provider-built URL, native auth headers
and message limit. Its backend owns verified TLS, RFC 6455 framing/validation,
ping/pong and bounded handshake parsing. It must not redirect credential-bearing
handshakes or expose their URLs in errors. `random_bytes` supplies OS cryptographic
entropy for the provider's UUIDs; there is no clock/PRNG fallback. Async authenticates
with its documented `api_key` and `version` query fields at this boundary.

`WebSocketLike` separates nonblocking `start_send`/`poll_flush` from `poll_receive`.
One write can remain backpressured while audio is received; the next input pull
waits for that write. Settings must flush before input is first polled. Readiness
must wake the executor; no timer threads, runtime-owned tasks or unbounded queues
are introduced. Drop the pending synthesis future or returned stream to cancel:
the backend must promptly abort pending handshakes/I/O on drop, and the input must
release its producer on drop. Cancellation releases the socket before the input.
Because Rust moves the request into this call, validation/auth/handshake failure
also drops the owned input without polling it. There is no borrowed-input cleanup
promise or separate signal/deadline API; an executor's cancellation can drop the
future/stream even while the consumer is idle.

Auth uses the shared `Auth.async_` entry before scoped/native environment keys;
explicit empty entries fail. `Options::default()` selects 16 MiB JSON/error bodies
and 4 MiB messages; explicit zero limits fail. Limits also apply to injected
messages. Shared fixtures cover every HTTP byte split, while owned mock backends
test incremental wire values, backpressure, terminal errors and dropping pending
handshakes/reads without another poll. These tests validate the provider and
backend contract, not any particular third-party Rust TLS/WebSocket backend.

## CAMB Python, Go and Rust synthesis

`speechswitch.providers.camb.synthesize` accepts the generated `camb.TtsRequest`
and returns bytes or generated `camb_output.SegmentOutput` envelopes. Always use
`async with` to release HTTP bodies, sockets and acquired input iterators on
completion, failure, task cancellation or early loop exit. HTTP uses an injected
`HttpTransport`; live input creates a native WebSocket unless `web_socket` is
provided. A backpressured write does not block incoming audio, and input is not
acquired until `session.ready`. Producers must cooperate with task cancellation.

All five documented HTTP models, encoded formats and six PCM encodings are
mapped explicitly. Incremental text and whole text with word timestamps use the
fixed `mars8.1-flash-beta` live model and encoded output. Native segment IDs give
ordered correlation; absent best-effort timestamps stay empty. Skipped segments,
unsafe IDs, timing overflow and incomplete sessions fail without fabricated events.

Auth resolves `Auth.camb` before `SPEECHSWITCH_CAMB_API_KEY` and `CAMB_API_KEY`;
explicit empty keys fail. Native WebSockets use `x-api-key` headers and remove
stale `api_key` query credentials. Error bodies default to a 1 MiB limit and
WebSocket messages to 4 MiB, including injected messages. Limits are positive
integers. There is no automatic retry or unrequested audio buffering.

Normalized requests, validators and outputs still come from `schemas/` in all
three languages. CAMB's complete cataloged OpenAPI/AsyncAPI additionally generate
the Python wire client under `speechswitch/clients/` via `generate:clients`.
Executable mutation tests change the contracts and check the resulting types,
validation, route, authentication and codecs. Shared TypeScript/Python segment
fixtures are in `sdks/fixtures/camb.json` and also run against Go and Rust.

Go's `providers/camb.Synthesize(ctx, request, options)` supports the same HTTP,
incremental and timed whole-text branches. It uses native HTTP/WebSockets by
default, with injectable `Options.Transport` and `Options.WebSocket`. Defer the
returned stream's `Close`, including when never reading. A successful live call
transfers ownership of its input; input `Close` must unblock a pending `Next`.
Both the synthesis context and an individual `Next` context cancel the connection.
Incoming audio can progress during one backpressured write, without prefetching
the next input chunk. Zero byte limits select the same defaults as Python;
negative limits fail. Authentication is resolved at the public boundary.

The Go wire client under `sdks/go/clients/camb/` is generated from the same
cataloged contracts. Its specialized codecs retain optional versus nullable
values, reject unsupported events and invalid known fields, and preserve native
binary audio. It rejects text not representable as UTF-8 instead of allowing
Go's JSON decoder to replace malformed bytes or lone surrogate escapes silently.
Mutation tests execute the Python, Go and Rust generated clients against the same
changed contracts.

Generated Go literal-only unions now expose `LiteralValue()` with a `string`,
`bool` or `float64` result when all alternatives share that scalar type. Their
sealed variants remain intact; nullable/mixed/object unions are not widened.
This lets CAMB use its generated locale and format choices without a handwritten
switch over hundreds of language wrappers or runtime reflection.

The Rust wire client under `sdks/rust/src/clients/camb.rs` is generated from those
same contracts. It has owned wire types, specialized JSON codecs, native binary
messages and an injected streaming HTTP transport. Optional nullable properties
retain three states through `Option<Option<T>>`; unknown properties retain their
raw JSON. Strict decoding rejects lone surrogate escapes, including unknown keys,
instead of silently replacing text. Rust literal-only unions also expose a const
`value()` accessor without widening their variants.

Rust's `providers::camb::synthesize(request, Options)` takes the owned generated
`camb::TtsRequest` and returns an `InputStream<camb_output::SynthesisItem>`. It
supports all three branches: static HTTP, incremental text, and timestamped whole
text over WebSockets. Static requests require `Options.transport`; both live
branches require `Options.web_socket_transport`. As with the Rust Async adapter,
these are injectable native-backend contracts, not a bundled TLS/WebSocket client.
No third-party runtime dependency or executor is imposed.

```rust
use speechswitch_types::{
    generated::{auth::Auth, camb::TtsRequest},
    http::{HttpTransport, TransportError},
    providers::camb::{self, Options, Stream},
    websocket::WebSocketTransport,
};

async fn open(
    request: TtsRequest,
    auth: &Auth,
    http: &dyn HttpTransport,
    sockets: &dyn WebSocketTransport,
) -> Result<Stream, TransportError> {
    camb::synthesize(request, Options {
        auth: Some(auth), transport: Some(http),
        web_socket_transport: Some(sockets), ..Options::default()
    }).await
}
```

The provider creates the socket through that backend with native `x-api-key`
headers and removes stale `api_key` query fields. It never requests random
correlation IDs: CAMB supplies segment IDs. Input is first polled only after
`session.ready` and the settings write has flushed. Audio remains readable while
one text write is backpressured; no next input chunk is prefetched. Empty chunks
are retained with explicit indexes, and input EOF sends `text.done`.

Drop the synthesis future or returned stream to cancel pending initialization,
I/O or input without another poll. The owned socket is released before an
unfinished producer; schema/auth/handshake failure also drops input without
polling it. Backends and producers must honor their nonblocking/drop contracts.
HTTP error bodies are bounded and reported while polling the returned stream;
successful audio is not buffered. EOF and errors release resources immediately
and are terminal. `Options::default()` selects 1 MiB error bodies and 4 MiB
messages; explicit zero limits fail. Tests cover all 50 HTTP model/format
combinations, shared segment fixtures, exact settings/auth, original error
identity and dropping pending reads/writes/initialization. They exercise the
adapter/backend contract, not any particular external TLS implementation.

## Cartesia Python synthesis

`speechswitch.providers.cartesia.synthesize` accepts the generated
`cartesia.TtsRequest` and streams bytes or generated `cartesia_output` items.
Sonic 3/3.5 use base language codes; Sonic 3.6 also supports regional locales.
Existing custom/catalog voice IDs, accent, speed, volume, emotions, pronunciation
dictionary IDs and text normalization retain their independent normalized fields.
The request and input-item validators are generated, not reimplemented in Python.

```python
from speechswitch.generated.cartesia import TtsRequest
from speechswitch.http import HttpTransport
from speechswitch.providers.cartesia import synthesize

async def speak(transport: HttpTransport, api_key: str) -> None:
    request: TtsRequest = {
        "model": "sonic-3.6", "voice": "existing-custom-voice",
        "text": "Hello", "language": "en-GB",
        "output": {"format": "mp3", "sample_rate_hz": 44100, "bit_rate_bps": 128000},
    }
    async with synthesize(request, transport=transport,
                          auth={"cartesia": {"api_key": api_key}}) as stream:
        async for item in stream:
            if isinstance(item, bytes):
                ...  # Send these bytes to the consumer without buffering the response.
```

Whole text uses byte-native HTTP unless timestamps select SSE. Incremental text
uses native asyncio WebSockets, with an optional authenticated `web_socket`
override. HTTP and token exchange use an injected `HttpTransport`. Raw PCM,
mu-law and A-law work on all three routes; MP3/WAV stay exclusive to untimed HTTP.
There are no third-party runtime dependencies or automatic retries.

Auth resolves the shared `Auth.cartesia` entry before the scoped and native
environment variables: `SPEECHSWITCH_CARTESIA_API_KEY` / `CARTESIA_API_KEY`, and
`SPEECHSWITCH_CARTESIA_ACCESS_TOKEN` / `CARTESIA_ACCESS_TOKEN`. HTTP prefers a
present API key over a token; an explicitly empty key fails. Native WebSockets
prefer a nonempty access token; otherwise the API key is exchanged for a TTS-only
60-second token. The secret API key is never added to the WebSocket URL, and stale
`api_key` query entries are removed. The authenticated socket override skips
credential resolution requirements and token exchange.

Input strings concatenate verbatim. `clear` cancels and retires the current
context, emits a local playback boundary and discards late output from that
context; it is not a server acknowledgment. `flush` retains the context and
reports the native `flush_done` acknowledgment/group ID. Native context completion
rotates an open input stream onto a fresh context without guessed expiry or replay.
Audio and word/phoneme timestamps retain independent timeline envelopes, using
native context and flush IDs; seconds become finite milliseconds.

Always use `async with`: it owns response bodies, sockets and acquired input
iterators, including early exit, protocol/input errors and task cancellation.
Unread live streams close the socket without acquiring the input. Cleanup releases
the socket before canceling pending I/O/input and closing the iterator; transport
overrides must support idempotent close, and producers must cooperate with
cancellation. A backpressured write does not block incoming audio or prefetch the
next input item. Ready input/writes and output are scheduled fairly so a continuous
audio stream cannot starve a clear command. Original failures and cancellation
survive secondary cleanup errors.

Optional `timeout_ms` covers token exchange, connection, input waits and response
consumption; no deadline is imposed by default. Values are integers from 0 through
2147483647, with zero failing immediately. `max_message_bytes` and `max_event_bytes`
default to 4 MiB; `max_json_bytes` defaults to 1 MiB. All byte limits are positive
integers, including for injected transports. Structured errors retain status,
nullable/future error codes, request IDs, documentation URLs and native contexts.

Cartesia's incomplete/contradictory contracts are not wire-codegen inputs. Its
protocol is handwritten; normalized requests, validators and output types are
still generated from TypeScript in all three languages. Shared TS/Python SSE
fixtures run at every Python byte split. Tests also cover native loopback
WebSockets/token exchange, exact wire mappings, cleanup failures, barge-in fairness
and deadlines. They do not claim live authenticated provider verification.

## Cartesia Go synthesis

`providers/cartesia.Synthesize(ctx, request, options)` takes the generated
`cartesia.TtsRequest` and returns `runtime.Input[cartesia_output.SynthesisItem]`.
It implements the same byte-native HTTP, timestamped SSE and incremental WebSocket
routes as Python, including all three models, custom voices, independent controls,
clear/flush, context rotation and native timeline/group correlation. All eight
model/input/timing alternatives stay explicit in the generated request types;
generated validation runs before conversion, network access or input pulls.

Go uses native HTTP and WebSockets by default, with injectable `Options.Transport`
and already-authenticated `Options.WebSocket`. Auth uses the shared `Auth.Cartesia`
entry and the same presence-sensitive environment precedence and token exchange
as Python. Native sockets receive short-lived tokens, never the secret API key;
stale query credentials are removed. The underlying transports do not redirect
credential-bearing requests. Go rejects malformed UTF-8 and lone surrogate escapes
in wire JSON rather than silently changing their text.

Always defer the returned stream's `Close`, including if never reading it. A
successful live call transfers input ownership, whereas validation, authentication
or handshake failure leaves the input unpolled and unclosed. Producer `Close` must
unblock pending `Next`; socket overrides must close idempotently and release
pending I/O. Cancellation releases the socket before input cleanup. Use the
synthesis context for whole-operation deadlines, including token exchange,
handshake and idle periods between consumer pulls; individual `Next` contexts
can also cancel a stream. No default synthesis deadline is imposed.

One input pull, write and socket receive can be outstanding. Audio stays readable
during a backpressured write, without prefetching input; scheduling alternates
between ready output and input/write completion so audio cannot starve barge-in.
End-of-stream and errors release resources and are terminal; original transport
and producer errors are preserved. Byte slices returned to the consumer are owned.
Zero byte limits select 4 MiB messages/events and 1 MiB JSON/error bodies; negative
limits fail. Protocol checks apply to injected transports too.

Tests execute all shared SSE fixtures at every byte split, all 27 HTTP
model/encoding combinations, the six live/timed request representations,
native HTTP/WebSockets and token exchange, context retirement, error identity,
ready-control fairness and resource ownership. Cancellation tests also run under
Go's race detector. Three exact negative compile tests reject older-model
regional locales, MP3 streaming output and non-timeline correlation. These tests
are local protocol/lifecycle checks, not live authenticated synthesis verification.

## Cartesia Rust synthesis

`providers::cartesia::synthesize(request, Options)` owns the generated
`cartesia::TtsRequest` and returns an `InputStream<cartesia_output::SynthesisItem>`.
It implements byte-native HTTP, timestamped SSE and incremental WebSockets,
including model-specific language/locale fields, existing custom voices,
independent controls, clear/flush and native timeline/context/group association.
Requests and input items use generated validation; the incomplete upstream wire
contract is implemented directly in the provider, not repaired for codegen.

Rust requires an injected `Options.transport` for HTTP and token exchange, and
`Options.web_socket_transport` for native sockets. The application supplies its
HTTP/TLS/WebSocket backend and executor; no runtime package is bundled. Shared
auth, environment precedence and native short-lived socket tokens work as above.
An owned, already-authenticated `Options.web_socket` skips token/auth resolution.

Timestamped HTTP and socket overrides additionally require `Options.entropy`, an
`entropy::Entropy` implementation or compatible callback using OS cryptographic
randomness. Native sockets otherwise use their backend's `random_bytes` method;
untimed HTTP needs no entropy. One random session prefix plus a checked context
counter supplies unique IDs, which Cartesia permits to be arbitrary strings.
There is no fallback PRNG. The returned stream retains no backend/entropy borrow.

```rust
use speechswitch_types::{
    entropy::Entropy,
    generated::{auth::Auth, cartesia::TtsRequest},
    http::{HttpTransport, TransportError},
    providers::cartesia::{self, Options, Stream},
    websocket::WebSocketTransport,
};

async fn open(
    request: TtsRequest,
    auth: &Auth,
    http: &dyn HttpTransport,
    sockets: &dyn WebSocketTransport,
    entropy: &dyn Entropy,
) -> Result<Stream, TransportError> {
    cartesia::synthesize(request, Options {
        auth: Some(auth), transport: Some(http),
        web_socket_transport: Some(sockets), entropy: Some(entropy),
        ..Options::default()
    }).await
}
```

Drop the opening future or returned stream to cancel, including while idle
between pulls. Unlike Go's borrowed initialization input, Rust moves the request:
validation/auth/handshake failures also drop its unpolled producer. An active
stream releases the socket before an unfinished producer; normal input EOF may
release the completed producer earlier. Backends must release pending I/O on drop.
No synthesis timeout or executor is imposed; application deadlines must drop the
future/stream. Byte limits default to 4 MiB messages/events and 1 MiB JSON/errors;
explicit zero is invalid.

Audio remains readable during a backpressured write, with no input prefetch.
Ready input/write and receive lanes alternate, preventing continuous audio from
starving `clear` or write errors. Native `done` rotates a still-open context without
replaying text; clear retires it and discards late output. Completion and errors
release ownership immediately and remain terminal, preserving backend/input errors.

Tests cover every shared SSE fixture at every byte split, all 27 HTTP model/encoding
combinations, all six live/timed request shapes, native-backend token auth,
backpressure, context rotation, control fairness, wire failures and pending-drop
ownership. Three exact compiler failures reject regional locales on older models,
MP3 streaming and non-timeline correlation. These are local backend/protocol tests,
not live authenticated synthesis or certification of an application TLS backend.

## Checks

With Node 22.18+, Rust/Cargo, Go, Python 3.13+ and Pyright available:

```sh
bun run check:languages
```

The check compiles every generated provider, tests HTTP ownership and streaming/literal primitives,
compiles unusual shapes extracted from a real TypeScript fixture, and verifies
sixty expected compile failures. In particular, xAI commands cannot enter Amazon's
string-only stream, and Hume Octave 2 cannot receive Octave 1 acting instructions.
Murf's fractional variation choices remain numeric subtypes in Python while
rejecting unsupported values; its incremental voice updates preserve zero values.
OpenAI's legacy models reject mini-only instructions in all three compilers;
custom-voice requests retain their modern model and explicit false usage setting.
Smallest.ai's Pro model permits Japanese while its standard model rejects it in
all three compilers; explicit false math reading and empty dictionary lists survive.
Typecast's v21 rejects v30 Smart Emotion; its modern branch preserves present empty
context and explicit zero loudness/seed. Composition bounds are retained in generated
documentation and executable validators in all three languages.
Vocu preserves existing voice/style IDs, zero seeds and explicit false controls;
all three compilers reject SRT on its controllable-markup branch. Inline splitter
bindings retain omission, rather than inserting defaults over native inheritance.
Voice.ai distinguishes legacy/current APIs and model-specific languages; all three
compilers reject Spanish on its English-only Lite model. Numbered dictionary
versions remain numeric and zero temperature survives. Its flush acknowledgment
has a context ID but no second native input-group ID, so the shared flush event's
`inputGroupId` is now genuinely optional across the four languages.
Output tests preserve independent timestamp delivery and control messages, reject
unsupported event literals, and reject bare audio in timestamp-only streams.
Cartesia's negative cases reject regional locales on older models, MP3 streaming
output and incorrect chunk correlation in all three compilers. Python also rejects
WAV timestamp requests.

Mistral's nested JSON metadata is derived structurally from its authored TypeScript
JSON algebra, not recognized by an alias name. Undefined values and cycles are
rejected by generated TypeScript request checks. Foreign JSON types distinguish
null, false, zero, arrays and objects, and reject raw byte arrays as JSON. They
remain data types rather than provider wire requests. Generated request checks in
all three languages validate JSON values and finite numbers. Python and Go reject
cycles, and Go rejects nil union/interface values; Rust's owned JSON tree cannot
form cycles through its public representation.

The implementation has been checked using Rust 1.91.1, Go 1.25.10, Python 3.13.12
and Pyright 1.1.407. The Go negative-test diagnostics are asserted exactly; toolchain
diagnostic changes should be reviewed explicitly rather than matched by substring.

Run `go test -race ./runtime ./providers/...` from `sdks/go` for cancellation race
checks. HTTP tests cover first-chunk delivery, early close, status/read failures,
empty chunks and cancellation before headers and during reads. Go also uses a
local HTTP server to exercise its native transport without provider credentials.

The next layer should port one provider end to end with shared protocol fixtures,
not transpile handwritten TypeScript adapters. Complete trustworthy upstream
contracts can drive wire codegen; partial provider contracts still need handwritten
adapters. The no-third-party-runtime-dependency policy remains in effect. In Rust,
production HTTP/WebSocket/TLS therefore needs an injected transport unless that
policy is deliberately changed.
