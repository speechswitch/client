---
name: integrating-speech-providers
description: Adds or changes Speech Switch provider adapters, upstream contracts, and streaming protocols. Use for provider integrations, transport changes, or synthesis lifecycle bugs.
---

# Integrating speech providers

Implement one provider's demonstrated capabilities without widening the shared SDK
to accommodate speculative features. Read the root `AGENTS.md` first. Paths below
are relative to the repository root.

## Establish the contract

1. Read `schemas/sources.yaml`, the provider's authored schema, adapter, and tests.
   Compare upstream REST and streaming documentation before choosing a protocol.
   Catalog unmodified definitions under `schemas/sources/<provider>/` with their
   URL, format, and SHA-256. Do not treat a prose snapshot as a complete wire schema.
2. Generate a wire client only when the upstream machine-readable contract covers
   the operation faithfully. Amazon's Botocore client is the generated example;
   xAI's conflicting/incomplete references require a handwritten provider-local
   protocol. Do not repair upstream snapshots or generate a static handwritten template.
3. Add plain request types under `schemas/providers/`. Demonstrate valid and invalid
   combinations with unions, literals, and `never`; add shared concepts to
   `schemas/base.ts` only when this integration needs them. Use the
   `evolving-speech-schemas` skill for extraction, validation, or mapping changes.

## Implement at the owning boundary

- Put the adapter in `sdk/providers/<provider>/index.ts`. Use shared `Auth` and
  `ProviderOptions`; resolve credentials/defaults once at public boundaries.
- Prefer the lowest-latency byte-native endpoint. Inject `fetch`, sockets, or the
  existing AWS event-stream client. Keep authentication and message codecs in the
  provider, not in the generic WebSocket transport. Add no SDK runtime packages.
- Apply generated partial serializers only to mechanical field mappings. Complete
  protocol-specific values and conversions explicitly and check the final wire type.
- Keep `synthesize` byte-only. Expose supported timestamp envelopes and native
  control events through `synthesizeWithTimestamps`, retaining the selected
  provider's concrete return type through dispatch.
- Preserve native correlation and normalize timestamp units to milliseconds.
  Independent audio and speech-mark streams remain `timeline` envelopes even if
  their arrivals happen to alternate.

## Verify the lifecycle, not just successful audio

Validate the request before network work and validate each input item as consumed.
Do not acquire an input iterator during request validation. Keep session controls
provider-specific: only expose clear, flush, or update when the protocol supports
them, and distinguish sending a command from receiving its acknowledgement.

For affected streaming paths, test trailing-text completion, pending acknowledgements,
abort, producer failure/stall, malformed frames, premature close, and early consumer
exit. Ensure sockets/listeners/producers are released without waiting indefinitely
for a stalled producer. Use the `testing-speech-behavior` skill for test patterns.

Regenerate the registry when adding a provider, the spec after schema changes, and
clients only when applicable. Run `bun run check`. Keep the integration in one PR;
separate shared prerequisites from provider-specific work. State whether validation
used injected transports, native loopback connections, or a live provider.

## History behind this workflow

- [Generate direct Polly event-stream bindings](https://github.com/speechswitch/client/commit/3e383f831df9e33436879c9d031f7ec74ec567d0)
  resolves wire structure ahead of time rather than interpreting operation descriptors.
- [Keep xAI protocol implementation provider-local](https://github.com/speechswitch/client/commit/0cce9c2c46008898bfd23597da2d7612890f2c34)
  reverses the preceding generated xAI protocol approach.
- [Restore raw audio synthesis](https://github.com/speechswitch/client/commit/40511f14490d8790117863c4ed4fb2108cce2714)
  supersedes the earlier mixed audio/event `synthesize` result.
- [Simplify transport and preserve provider-specific types](https://github.com/speechswitch/client/commit/a06198a8516ff0f677614c9ec3ddf70d0c5617b3)
  keeps transport state small and dispatch results provider-specific.
- [Use replacement maps and shared provider options](https://github.com/speechswitch/client/commit/ae63ad6)
  removes duplicated option interfaces and unnecessary map conversions.
