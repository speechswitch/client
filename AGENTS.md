# Engineering conventions

## API model

- Keep normalized requests flat; translate vendor nesting only in adapters.
- Use consistent provider-neutral names. Model orthogonal concepts separately, such
  as `format` and `sampleRateHz`, rather than encoding one inside another.
- Add a normalized field only when an integration demonstrates the shared concept.
- Encode documented and observed invariants with unions, literals, and `never`.
- Treat voice selection and reference audio as independent capabilities.
- Keep authored schema types plain. The base and every provider export their own
  non-generic `TtsRequest`; do not derive provider requests with conditional types,
  intersections, `Pick`, or other type-level machinery.
- Enforce provider subsets and narrowing in specgen rather than in authored types.
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

- Resolve environment values and defaults at public provider boundaries. Pass fully
  resolved, required configuration internally.
- Use optional properties only for genuine domain states or public dependency
  overrides, not as a substitute for resolving configuration.
- Pass one shared `Auth` object through the SDK; adapters read their own nested entry.
- Make network dependencies injectable. HTTP uses an injected `fetch`; WebSocket
  transports receive an injected `WebSocketLike` and explicit codecs.
- Create native WebSockets at the provider boundary. The public provider options may
  expose `webSocket?: WebSocketLike` as a test or runtime override.
- Keep wire conversions explicit. Audio is `Uint8Array`; decode base64 only when the
  provider protocol requires it.
- Prefer the provider's lowest-latency byte-native protocol.

## Streaming and timestamps

- Return timestamped streaming data in envelopes.
- Represent correlation explicitly as `chunk`, `ordered`, or `timeline`.
- Preserve native chunk association when it exists. Never infer association from
  arrival order when timestamps and audio come from independent timelines.

## Repository workflow

- Keep canonical API and provider capability types in the runtime-free `schemas/`
  TypeScript project.
- Use the workspace TypeScript 7 installation for checks and editor services.
- Do not hand-edit generated files.
- Add each integration in its own pull request, including schemas, generated clients,
  adapter, normalized type additions, tests, and registry update.
- Prefer small, direct implementations and comments that explain only non-obvious
  constraints or decisions.
