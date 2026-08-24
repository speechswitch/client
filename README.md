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

The project pins TypeScript 7 locally. Editors should use the TypeScript language
server and compiler from this workspace's `node_modules`.
