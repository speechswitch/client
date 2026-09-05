# Generated language types

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

This is the **type foundation, not three complete synthesis SDKs**. The generated
modules cover the base request and every integrated provider. Networking,
provider adapters, normalized/wire codecs, output envelopes and executable
request validators are not yet ported. Do not serialize these structs directly
as provider wire requests or treat type checking as validation of external data.

## Layout and generation

- `sdks/rust`: dependency-free `speechswitch-types` crate.
- `sdks/python`: Python 3.13+ typed package using standard-library typing only.
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
| Exact scalar choice | Singleton value types | Literal; singleton Enum for fractional values | Singleton value types |
| Omitted property | Option | NotRequired, without adding None | Optional with explicit presence |
| Explicit null | Separate null variant | None only where authored | Separate null variant |
| Audio bytes | Vec of u8 | bytes | byte slice |
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
cancellation and cleanup, including Python iterator cleanup. These contracts do
not claim that arbitrary uncooperative producers can be forcibly canceled.

## Checks

With Node 22.18+, Rust/Cargo, Go, Python 3.13+ and Pyright available:

```sh
bun run check:languages
```

The check compiles every generated provider, tests streaming/literal primitives,
compiles unusual shapes extracted from a real TypeScript fixture, and verifies
ten expected compile failures. In particular, xAI commands cannot enter Amazon's
string-only stream, and Hume Octave 2 cannot receive Octave 1 acting instructions.

The implementation has been checked using Rust 1.91.1, Go 1.25.10, Python 3.13.12
and Pyright 1.1.407. The Go negative-test diagnostics are asserted exactly; toolchain
diagnostic changes should be reviewed explicitly rather than matched by substring.

The next layer should port one provider end to end with shared protocol fixtures,
not transpile handwritten TypeScript adapters. Complete trustworthy upstream
contracts can drive wire codegen; partial provider contracts still need handwritten
adapters. The no-third-party-runtime-dependency policy remains in effect. In Rust,
production HTTP/WebSocket/TLS therefore needs an injected transport unless that
policy is deliberately changed.
