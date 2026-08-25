# @speechswitch/router

A provider-neutral, strongly typed TypeScript router for low-latency speech
synthesis, streaming audio, and timestamps.

This branch intentionally contains no provider integrations. It establishes the
shared request, authentication, timestamp, transport, generation, and dispatch
mechanics. Integrations are added one at a time through reviewed pull requests.

```sh
bun install
bun run check
```

Specification generation requires Node.js 22.18 or newer. The SDK and its tests
continue to use Bun normally.

The project pins TypeScript 7 locally. Editors should use the TypeScript language
server and compiler from this workspace's `node_modules`.

`TtsRequestBase` is the canonical normalized speech specification. The build-time
extractor uses TypeScript 7's native checker to validate provider narrowing and
generate Zod validators and API documentation directly. Provider modules must
export a `TtsModels` interface keyed by their exact model identifiers. Run
`bun run generate:spec` after changing the normalized API.

```ts
import type { TtsRequest } from "../../tts-request.ts";

export interface TtsModels {
  readonly "exact-model-id": TtsRequest<{
    readonly text: string;
  }>;
}
```

Ordinary JSDoc supplies generated field documentation. Use `@minimum`,
`@maximum`, and `@pattern` only for runtime constraints that TypeScript cannot
express; provider annotations may narrow but never widen their base constraint.
