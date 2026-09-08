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
are generated from the same runtime-free schema project. Provider adapters,
normalized/wire codecs and executable request validators are not yet ported.
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
remains distinct from omission. Numeric bounds and ECMAScript patterns still need
generated runtime validation at the future public synthesis boundaries. Go zero
values can contain missing required interfaces; Python typing is not a runtime
validator; Rust f64 permits non-finite values. None of those are advertised as
validated synthesis requests.

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
are still necessary at future provider boundaries.

## Checks

With Node 22.18+, Rust/Cargo, Go, Python 3.13+ and Pyright available:

```sh
bun run check:languages
```

The check compiles every generated provider, tests HTTP ownership and streaming/literal primitives,
compiles unusual shapes extracted from a real TypeScript fixture, and verifies
thirty-five expected compile failures. In particular, xAI commands cannot enter Amazon's
string-only stream, and Hume Octave 2 cannot receive Octave 1 acting instructions.
Murf's fractional variation choices remain numeric subtypes in Python while
rejecting unsupported values; its incremental voice updates preserve zero values.
OpenAI's legacy models reject mini-only instructions in all three compilers;
custom-voice requests retain their modern model and explicit false usage setting.
Smallest.ai's Pro model permits Japanese while its standard model rejects it in
all three compilers; explicit false math reading and empty dictionary lists survive.
Typecast's v21 rejects v30 Smart Emotion; its modern branch preserves present empty
context and explicit zero loudness/seed. Composition bounds are retained in generated
documentation; executable foreign-language validators remain future work.
Vocu preserves existing voice/style IDs, zero seeds and explicit false controls;
all three compilers reject SRT on its controllable-markup branch. Inline splitter
bindings retain omission, rather than inserting defaults over native inheritance.
Output tests preserve independent timestamp delivery and control messages, reject
unsupported event literals, and reject bare audio in timestamp-only streams.

Mistral's nested JSON metadata is derived structurally from its authored TypeScript
JSON algebra, not recognized by an alias name. Undefined values and cycles are
rejected by generated TypeScript request checks. Foreign JSON types distinguish
null, false, zero, arrays and objects, and reject raw byte arrays as JSON. They
remain data types rather than serializers or validated network requests; finite
numbers, non-nil Go interface values and cycle checks still belong at future
foreign-language synthesis boundaries.

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
