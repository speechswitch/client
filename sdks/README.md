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
are generated from the same runtime-free schema project. Provider adapters
and normalized/wire codecs are not yet ported. All three languages now have
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

Each helper returns raw byte chunks without collecting the response, decoding
base64, or guessing timestamp association. It closes non-2xx responses without
reading their potentially unbounded or sensitive error bodies. EOF and read
errors release the body immediately. Empty chunks are not EOF; bytes returned
alongside a Go read error are delivered before the error. Consumers own returned
chunks; later reads do not overwrite them.

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
TypeScript validator. It emits specialized predicates, not schema descriptors or
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
type errors. It also compares generated Go/Python validators against TypeScript;
the Go suite currently covers 27 providers, 18,549 typed request cases and 15,714
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

The Rust/TypeScript differential suite covers all 27 providers with 17,495 typed
request cases and 15,714 regex cases, including direct UTF-16 matcher inputs that
Rust strings cannot represent. The combined language check also tests ownership,
provider input narrowing, exact errors, nullable fields, bytes and unbounded
integers. Existing generated request type declarations remain unchanged; this
layer does not yet add Rust provider synthesis adapters or wire codecs.

## Checks

With Node 22.18+, Rust/Cargo, Go, Python 3.13+ and Pyright available:

```sh
bun run check:languages
```

The check compiles every generated provider, tests HTTP ownership and streaming/literal primitives,
compiles unusual shapes extracted from a real TypeScript fixture, and verifies
thirty-eight expected compile failures. In particular, xAI commands cannot enter Amazon's
string-only stream, and Hume Octave 2 cannot receive Octave 1 acting instructions.
Murf's fractional variation choices remain numeric subtypes in Python while
rejecting unsupported values; its incremental voice updates preserve zero values.
OpenAI's legacy models reject mini-only instructions in all three compilers;
custom-voice requests retain their modern model and explicit false usage setting.
Smallest.ai's Pro model permits Japanese while its standard model rejects it in
all three compilers; explicit false math reading and empty dictionary lists survive.
Typecast's v21 rejects v30 Smart Emotion; its modern branch preserves present empty
context and explicit zero loudness/seed. Composition bounds are retained in generated
documentation and Python validation; executable Rust/Go validators remain future work.
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

Mistral's nested JSON metadata is derived structurally from its authored TypeScript
JSON algebra, not recognized by an alias name. Undefined values and cycles are
rejected by generated TypeScript request checks. Foreign JSON types distinguish
null, false, zero, arrays and objects, and reject raw byte arrays as JSON. They
remain data types rather than serializers or validated network requests. Python's
generated request checks now validate finite JSON numbers and reject cycles;
Rust/Go validation, including non-nil Go interface values, remains future work.

The implementation has been checked using Rust 1.91.1, Go 1.25.10, Python 3.13.12
and Pyright 1.1.407. The Go negative-test diagnostics are asserted exactly; toolchain
diagnostic changes should be reviewed explicitly rather than matched by substring.

Run `go test -race ./runtime` from `sdks/go` for additional cancellation race
checks. HTTP tests cover first-chunk delivery, early close, status/read failures,
empty chunks and cancellation before headers and during reads. Go also uses a
local HTTP server to exercise its native transport without provider credentials.

The next layer should port one provider end to end with shared protocol fixtures,
not transpile handwritten TypeScript adapters. Complete trustworthy upstream
contracts can drive wire codegen; partial provider contracts still need handwritten
adapters. The no-third-party-runtime-dependency policy remains in effect. In Rust,
production HTTP/WebSocket/TLS therefore needs an injected transport unless that
policy is deliberately changed.
