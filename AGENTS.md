# Engineering conventions

These conventions reflect the merged history of `redevelop`. Prefer later
corrections over superseded designs; an unmerged provider branch is not precedent.
Keep durable constraints here and task-specific procedures in the repository skills:

- [Integrating providers](.agents/skills/integrating-speech-providers/SKILL.md):
  upstream contracts, adapters, transports, and streaming lifecycle.
- [Evolving schemas](.agents/skills/evolving-speech-schemas/SKILL.md): authored types,
  specgen, validation, defaults, and wire serializers.
- [Testing behavior](.agents/skills/testing-speech-behavior/SKILL.md): Node tests,
  small fixtures, exact diagnostics, and injected transports.
- [Developing the playground](.agents/skills/developing-speech-playground/SKILL.md):
  schema-derived forms, request preservation, and UI verification.

## API model

- Structure normalized requests around shared concepts. Keep independent options
  flat, but use tasteful nesting when fields form one cohesive value or invariant;
  never preserve vendor nesting merely because the vendor API uses it.
- Use consistent provider-neutral names. Model orthogonal concepts separately, such
  as `container`, `codec`, and `sampleRateHz`, rather than encoding one inside another.
- Add a normalized field only when an integration demonstrates the shared concept.
- Keep the base request focused on shared concepts. Use discriminated unions in
  base output types to enforce valid container, codec, and sample-format combinations.
  Provider types narrow these combinations and add documented model restrictions
  with unions, literals, and `never`.
- Treat voice selection and reference audio as independent capabilities.
- Keep authored schema types plain. The base and every provider export their own
  non-generic `TtsRequest`; do not derive provider requests with conditional types,
  intersections, `Pick`, or other type-level machinery.
- Enforce provider subsets and narrowing in specgen rather than in authored types.
- Generate runtime request checks from the authored schema types and annotations;
  do not duplicate their unions, literals, `never`, or bounds in provider adapters.
  Keep handwritten checks for protocol state and constraints the schema cannot express.
- Normalize base and provider types independently, compare the normalized schemas,
  then inherit base documentation and constraints after validation.
- Base specgen semantics on checker symbols, type identities, flags, and typed AST
  nodes. Use rendered type strings only for documentation and diagnostics.
- Normalize `undefined` only at an optional property boundary. Never erase it from
  required fields, collection elements, or other nested types.
- Include `AsyncIterable<string>` in a provider's `text` type only when it supports
  streaming input.
- Prefer inference at function call sites. Explicit generic arguments on function
  applications are a last resort when the inputs cannot carry the required type.

## Boundaries and dependencies

- Ship no third-party runtime dependencies. Implement provider protocols and codecs
  locally from the cataloged definitions; development-only tooling may use packages.
- Generate wire clients only from complete, trustworthy machine-readable contracts.
  If a provider's contract is partial, stale, or contradictory, implement its wire
  protocol directly in the provider module. Do not hand-repair a spec or wrap a
  static client template in codegen to manufacture a generated implementation.
- Generate specialized code directly. Never emit runtime schema descriptors,
  operation builders, or interpreters when codegen can resolve the structure ahead of time.
- Generated clients may depend on stable modules under `sdk/runtime/`, never on
  provider adapters. Providers may depend on generated clients and runtime modules.
- Resolve environment values and defaults at public provider boundaries. Pass fully
  resolved, required configuration internally.
- Use optional properties only for genuine domain states or public dependency
  overrides, not as a substitute for resolving configuration.
- Pass one shared `Auth` object through the SDK; adapters read their own nested entry.
- Reuse `ProviderOptions` from `sdk/options.ts` rather than duplicating the same
  public options interface in every provider.
- Make network dependencies injectable. Generated HTTP clients call their injected
  `fetch` directly; WebSocket transports receive an injected `WebSocketLike` and
  explicit codecs.
- Create native WebSockets at the provider boundary. The public provider options may
  expose `webSocket?: WebSocketLike` as a test or runtime override.
- Keep wire conversions explicit. Audio is `Uint8Array`; decode base64 only when the
  provider protocol requires it.
- Prefer the provider's lowest-latency byte-native protocol.
- Keep `synthesize` byte-only: it returns an async stream of `Uint8Array` for both
  string and streaming input. Use `synthesizeWithTimestamps` for timestamp envelopes
  and provider control events. Buffering is an explicit consumer operation, not a
  separate provider capability.
- Inline trivial conditions used once. Do not introduce one-line predicates or
  wrappers that only rename an expression without hiding real complexity.

## Streaming and timestamps

- Return timestamped streaming data in envelopes.
- Represent correlation explicitly as `chunk`, `ordered`, or `timeline`.
- Preserve native chunk association when it exists. Never infer association from
  arrival order when timestamps and audio come from independent timelines.
- Preserve the selected provider's request and return types through dispatch; do not
  widen every provider's result to a union of every provider's control events.
- Validate requests without mutating them or acquiring/advancing async input.
  Validate streaming items separately when consumed, against the matching request
  variants. Keep protocol acknowledgements and session state in the adapter.

## Tests and diagnostics

- Use `node:test` with standalone `expect` assertions in `*.node-test.ts` files.
  Bun runs package scripts; it is not the test runner.
- Prefer small, named behavioral tests and independent authored fixtures. Execute
  generated validators/serializers instead of asserting their source-code spelling.
- Assert exact diagnostics when the diagnostic is the behavior under test. Accumulate
  independent field errors, retain their paths, and discard failed union-branch
  diagnostics when another branch succeeds.
- Reuse injected network dependencies and `test-support/fake-websocket.ts`; use
  local loopback servers when native transport behavior needs verification.

## Repository workflow

- Keep canonical API and provider capability types in the runtime-free `schemas/`
  TypeScript project.
- Keep raw provider definitions unchanged and catalog them with their upstream URL
  and content hash. Where codegen is warranted, generate wire clients from those
  snapshots; handwritten providers retain the same source and type-checking discipline.
- Use the workspace TypeScript 7 installation for checks and editor services.
- Do not hand-edit generated files.
- Add each integration in its own pull request, including schemas, adapter,
  normalized type additions, tests, registry update, and generated clients only
  when the upstream contract warrants them.
- Prefer small, direct implementations and comments that explain only non-obvious
  constraints or decisions.
- Use Oxfmt for authored code formatting; avoid unrelated formatting churn and do
  not reformat generated output independently of its generator.

Run commands from the repository root with Node >=22.18 and Bun available:

```sh
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd playground
bun run check
```

`package.json` is the command source of truth. `check` runs TypeScript checks, Node
tests, generated registry/spec/client verification, and playground typechecking.
After changing a source of generated output, run the corresponding
`generate:spec`, `generate:clients`, or `generate:registry` script and commit its
output. For playground build changes also run `bun run --cwd playground build`.
Report which checks actually ran; distinguish local protocol tests from live
provider acceptance tests.
