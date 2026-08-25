# SDK conventions

- Keep the normalized request flat. Vendor nesting exists only inside adapters.
- Add normalized request fields only when an integration demonstrates a need.
- Keep canonical API types and provider capability types in the dedicated
  `schemas/` TypeScript project; it must contain no runtime implementation.
- Capability objects are type-level selectors and narrowers; never intersect them
  into a request type.
- Keep credentials and routing in the shared `Auth` object passed through options.
- Audio is `Uint8Array`. Base64 is decoded only when a wire protocol requires it.
- Prefer the lowest-latency byte-native transport supported by an endpoint.
- Keep the WebSocket transport wire-agnostic; adapters must inject encoders and
  decoders instead of relying on implicit JSON or text behavior.
- Timestamp streams must state their correlation: `chunk`, `ordered`, or `timeline`.
- Do not imply audio/timestamp association that the source protocol does not provide.
- Each integration is one pull request containing its sources, generated clients,
  adapter, normalized type additions, tests, and registry update.
- Use the local TypeScript 7 installation for checks and editor language services.
