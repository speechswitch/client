# @speechswitch/router

A provider-neutral, strongly typed TypeScript router for low-latency speech
synthesis, streaming audio, and timestamps.

```sh
bun install
bun run check
```

Specification generation requires Node.js 22.18 or newer. The SDK and its tests
continue to use Bun normally.

The project pins TypeScript 7 locally. Editors should use the TypeScript language
server and compiler from this workspace's `node_modules`.

`schemas/` is a dedicated TypeScript project containing only API declarations.
`schemas/base.ts` defines the normalized `TtsRequest`; each provider defines its
plain `TtsRequest` subset in `schemas/providers/<provider>/index.ts`. The build-time
extractor validates provider narrowing and generates code and documentation. Run
`bun run generate:spec` after changing the API.

```ts
export type TtsRequest = {
  readonly text: string;
};
```

Ordinary JSDoc supplies generated field documentation. Use `@minimum`,
`@maximum`, and `@pattern` only for runtime constraints that TypeScript cannot
express; provider annotations may narrow but never widen their base constraint.
