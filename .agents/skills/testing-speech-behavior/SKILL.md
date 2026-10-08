---
name: testing-speech-behavior
description: Writes focused Speech Switch regression tests with Node, standalone expect, authored schema fixtures, and injected transports. Use when adding tests or verifying SDK and codegen fixes.
---

# Testing speech behavior

Test the observable contract with the smallest fixture that distinguishes correct
behavior from the likely bug. Read the root `AGENTS.md`. Paths and commands here
are relative to the repository root.

## Use the established test harness

- Write `*.node-test.ts` with `test`, `describe`, and lifecycle hooks from `node:test`
  and `expect` from the standalone `expect` package. Do not introduce Jest, Vitest,
  or `bun:test` as another runner.
- Name tests after the behavior or diagnostic. Prefer a few direct assertions over
  large provider-shaped fixtures, generic test frameworks, or loops that obscure
  which distinct rule failed.
- Run extraction directly in the Node test process. For generated behavior, write
  a small temporary TypeScript module, import it, execute it, and clean it up with
  `afterEach`. Reuse the local helpers in the codegen test files.
- Do not substitute emitted-source substring assertions for executing validators
  or serializers. Generated-file freshness is covered by the `verify:*` scripts.

## Pick regression cases that discriminate

- For validation, combine independent invalid siblings with a valid union alternative
  to catch accidental loss or leakage of diagnostics. Assert the exact error and
  paths when testing diagnostic behavior, not merely `.toThrow()`.
- For request/item separation, use an iterable whose `Symbol.asyncIterator` throws
  if acquired during validation; choose requests whose permitted items differ.
- For serialization, include unmapped getters that throw, omitted optional fields,
  false/zero values, and nested records with keys different from mapped field names.
  Freeze inputs when testing non-mutation. Compute expected objects independently.
- For provider APIs, pair runtime behavior with `@ts-expect-error` cases where
  relevant: another provider's controls or impossible codec/container combinations
  must not become accepted through dispatch inference.

## Test protocols at the right boundary

Reuse `test-support/fake-websocket.ts` and injected `fetch`/event-stream implementations
for deterministic adapter tests. Assert exact outgoing fields and incoming bytes,
timestamps, or acknowledgements. Use native local servers when the behavior is the
WebSocket upgrade, Authorization header, or HTTP/2 framing itself.

For streaming changes, exercise ordering and cleanup, not just collection of a
successful stream: independent audio/mark arrivals, fragmented records, abort,
premature close, producer errors/stalls, and early consumer return as applicable.
Use the provider's existing loopback tests as fixtures rather than a live account
for routine regression coverage. Do not describe local tests as live acceptance.

## Run focused checks, then the affected wider checks

```sh
node --test codegen/specgen.node-test.ts codegen/request-validator.node-test.ts
node --test sdk/providers/xai/index.node-test.ts
bun run check
```

Choose the relevant focused files; these are examples, not a requirement to run
unrelated provider tests for every edit. `check` covers type-level assertions,
the complete Node suite, generated-file freshness, and playground typechecking.
Report failures and unrun checks explicitly. Do not alter fixtures or expected
values merely to obtain a passing result.

## History behind this workflow

- [Run specgen tests in-process](https://github.com/speechswitch/client/commit/453d2477dcd063a94a574a89460c529342491d33)
  removes subprocess-based extraction scaffolding.
- [Migrate all tests to Node](https://github.com/speechswitch/client/commit/e6e4411)
  and [use standalone expect](https://github.com/speechswitch/client/commit/d80563ee59478aaa99cad21b4a26bfa4b84628a6)
  establish the runner/assertion split.
- [Simplify tests around validator behavior](https://github.com/speechswitch/client/commit/75910efb0f0d5ea32d26ca3f6c9b6be00bcf1745)
  removes source-shape assertions and shrinks fixtures.
- [Assert exact diagnostics in named tests](https://github.com/speechswitch/client/commit/a216d3fbbc6f052d9064ee9c2f31d78fe16600a3)
  makes each rejected default's reason independently visible.
