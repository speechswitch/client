# Integration inventory — 2026-09-07

Snapshot of implementation commit `3994c9b`. This inventory is a handoff, not a
declaration that the full integration/stacked-PR goal is complete.

## Scope and local implementation

GitHub currently has 26 open integration issues, #3–#28. Their stated scope and
every comment were inspected for this audit; only #28 has a comment, preferring byte-native
HTTP for whole-text xAI synthesis. Later repository instructions supersede the
original issues' codegen recipes when upstream machine-readable contracts are
incomplete. The adapters must then implement the wire protocol directly, while
public contracts and validators still derive from TypeScript.

All 26 have canonical provider schemas, a TypeScript adapter, Python/Go/Rust
adapters, generated request validators, shared fixtures and provider tests at this
snapshot. Presence is an inventory fact, not proof that every remote feature works.
Each row links the implementation and the focused fixture evidence; additional
protocol/lifecycle tests live beside the adapters and under `python/tests/`.

| Issue | Required surface to audit | Adapters | Shared fixture | Local language branch and head |
| --- | --- | --- | --- | --- |
| [#3 async](https://github.com/speechswitch/client/issues/3) | Three HTTP variants; incremental WebSocket input | [TS](../sdk/providers/async/index.ts) · [Python](python/speechswitch/providers/async_.py) · [Go](go/providers/async/) · [Rust](rust/src/providers/async_/mod.rs) | [Fixture](fixtures/async.json) | `provider/async-polyglot` · `90e8541` |
| [#4 camb](https://github.com/speechswitch/client/issues/4) | Live synthesis and REST | [TS](../sdk/providers/camb/index.ts) · [Python](python/speechswitch/providers/camb.py) · [Go](go/providers/camb/) · [Rust](rust/src/providers/camb/mod.rs) | [Fixture](fixtures/camb.json) | `provider/camb-polyglot` · `0bd9e6e` |
| [#5 cartesia](https://github.com/speechswitch/client/issues/5) | Bytes, SSE, WebSocket contexts and timestamps | [TS](../sdk/providers/cartesia/index.ts) · [Python](python/speechswitch/providers/cartesia.py) · [Go](go/providers/cartesia/) · [Rust](rust/src/providers/cartesia/mod.rs) | [Fixture](fixtures/cartesia.json) | `provider/cartesia-polyglot` · `a5a7af9` |
| [#6 deepdub](https://github.com/speechswitch/client/issues/6) | Streaming `/tts` and model/voice controls | [TS](../sdk/providers/deepdub/index.ts) · [Python](python/speechswitch/providers/deepdub.py) · [Go](go/providers/deepdub/) · [Rust](rust/src/providers/deepdub/mod.rs) | [Fixture](fixtures/deepdub.json) | `provider/deepdub-polyglot` · `10864ce` |
| [#7 deepgram](https://github.com/speechswitch/client/issues/7) | HTTP and Aura WebSocket | [TS](../sdk/providers/deepgram/index.ts) · [Python](python/speechswitch/providers/deepgram.py) · [Go](go/providers/deepgram/) · [Rust](rust/src/providers/deepgram/mod.rs) | [Fixture](fixtures/deepgram.json) | `provider/deepgram-polyglot` · `4fb52ef` |
| [#8 elevenlabs](https://github.com/speechswitch/client/issues/8) | HTTP and input-stream WebSocket | [TS](../sdk/providers/elevenlabs/index.ts) · [Python](python/speechswitch/providers/elevenlabs.py) · [Go](go/providers/elevenlabs/) · [Rust](rust/src/providers/elevenlabs/mod.rs) | [Fixture](fixtures/elevenlabs.json) | `provider/elevenlabs-polyglot` · `72a236f` |
| [#9 fish](https://github.com/speechswitch/client/issues/9) | Native TTS wire audio encoding | [TS](../sdk/providers/fish/index.ts) · [Python](python/speechswitch/providers/fish.py) · [Go](go/providers/fish/) · [Rust](rust/src/providers/fish/mod.rs) | [Fixture](fixtures/fish.json) | `provider/fish-polyglot` · `0e4dcff` |
| [#10 google](https://github.com/speechswitch/client/issues/10) | REST and protobuf streaming | [TS](../sdk/providers/google/index.ts) · [Python](python/speechswitch/providers/google.py) · [Go](go/providers/google/) · [Rust](rust/src/providers/google/mod.rs) | [Fixture](fixtures/google.json) | `provider/google-polyglot` · `5600245` |
| [#11 gradium](https://github.com/speechswitch/client/issues/11) | HTTP; explicitly documented WebSocket | [TS](../sdk/providers/gradium/index.ts) · [Python](python/speechswitch/providers/gradium.py) · [Go](go/providers/gradium/) · [Rust](rust/src/providers/gradium/mod.rs) | [Fixture](fixtures/gradium.json) | `provider/gradium-polyglot` · `987555a` |
| [#12 hume](https://github.com/speechswitch/client/issues/12) | HTTP file/JSON streaming and input WebSocket | [TS](../sdk/providers/hume/index.ts) · [Python](python/speechswitch/providers/hume.py) · [Go](go/providers/hume/) · [Rust](rust/src/providers/hume/mod.rs) | [Fixture](fixtures/hume.json) | `provider/hume-polyglot` · `bec07c5` |
| [#13 inworld](https://github.com/speechswitch/client/issues/13) | HTTP, streamed HTTP, timestamps and WebSocket | [TS](../sdk/providers/inworld/index.ts) · [Python](python/speechswitch/providers/inworld.py) · [Go](go/providers/inworld/) · [Rust](rust/src/providers/inworld/mod.rs) | [Fixture](fixtures/inworld.json) | `provider/inworld-polyglot` · `3330b22` |
| [#14 kugelaudio](https://github.com/speechswitch/client/issues/14) | Native TTS rather than compatibility routes | [TS](../sdk/providers/kugelaudio/index.ts) · [Python](python/speechswitch/providers/kugelaudio.py) · [Go](go/providers/kugelaudio/) · [Rust](rust/src/providers/kugelaudio/mod.rs) | [Fixture](fixtures/kugelaudio.json) | `provider/kugelaudio-polyglot` · `08e36fa` |
| [#15 lovo](https://github.com/speechswitch/client/issues/15) | Streaming synthesis from the NestJS contract | [TS](../sdk/providers/lovo/index.ts) · [Python](python/speechswitch/providers/lovo.py) · [Go](go/providers/lovo/) · [Rust](rust/src/providers/lovo/mod.rs) | [Fixture](fixtures/lovo.json) | `provider/lovo-polyglot` · `0b9eb6d` |
| [#16 microsoft](https://github.com/speechswitch/client/issues/16) | Synthesis REST; explicit richer protocol | [TS](../sdk/providers/microsoft/index.ts) · [Python](python/speechswitch/providers/microsoft.py) · [Go](go/providers/microsoft/) · [Rust](rust/src/providers/microsoft/mod.rs) | [Fixture](fixtures/microsoft.json) | `provider/microsoft-polyglot` · `fc37f7c` |
| [#17 minimax](https://github.com/speechswitch/client/issues/17) | HTTP T2A and documented WebSocket | [TS](../sdk/providers/minimax/index.ts) · [Python](python/speechswitch/providers/minimax.py) · [Go](go/providers/minimax/) · [Rust](rust/src/providers/minimax/mod.rs) | [Fixture](fixtures/minimax.json) | `provider/minimax-polyglot` · `482d6e5` |
| [#18 mistral](https://github.com/speechswitch/client/issues/18) | JSON/SSE audio, saved voices and reference audio | [TS](../sdk/providers/mistral/index.ts) · [Python](python/speechswitch/providers/mistral.py) · [Go](go/providers/mistral/) · [Rust](rust/src/providers/mistral/mod.rs) | [Fixture](fixtures/mistral.json) | `provider/mistral-polyglot` · `93b718b` |
| [#19 murf](https://github.com/speechswitch/client/issues/19) | Generate, stream and input WebSocket | [TS](../sdk/providers/murf/index.ts) · [Python](python/speechswitch/providers/murf.py) · [Go](go/providers/murf/) · [Rust](rust/src/providers/murf/mod.rs) | [Fixture](fixtures/murf.json) | `provider/murf-polyglot` · `414efcb` |
| [#20 openai](https://github.com/speechswitch/client/issues/20) | `/audio/speech` and documented model options | [TS](../sdk/providers/openai/index.ts) · [Python](python/speechswitch/providers/openai.py) · [Go](go/providers/openai/) · [Rust](rust/src/providers/openai/mod.rs) | [Fixture](fixtures/openai.json) | `provider/openai-polyglot` · `47cd9cf` |
| [#21 resemble](https://github.com/speechswitch/client/issues/21) | Three deployed Gradio synthesis APIs | [TS](../sdk/providers/resemble/index.ts) · [Python](python/speechswitch/providers/resemble.py) · [Go](go/providers/resemble/) · [Rust](rust/src/providers/resemble/mod.rs) | [Fixture](fixtures/resemble.json) | `provider/resemble-polyglot` · `445d607` |
| [#22 respeecher](https://github.com/speechswitch/client/issues/22) | Bytes, SSE and WebSocket | [TS](../sdk/providers/respeecher/index.ts) · [Python](python/speechswitch/providers/respeecher.py) · [Go](go/providers/respeecher/) · [Rust](rust/src/providers/respeecher/mod.rs) | [Fixture](fixtures/respeecher.json) | `provider/respeecher-polyglot` · `e7bb271` |
| [#23 rime](https://github.com/speechswitch/client/issues/23) | Coda/Mist HTTP and WebSocket lifecycle | [TS](../sdk/providers/rime/index.ts) · [Python](python/speechswitch/providers/rime.py) · [Go](go/providers/rime/) · [Rust](rust/src/providers/rime/mod.rs) | [Fixture](fixtures/rime.json) | `provider/rime-polyglot` · `2a8162f` |
| [#24 smallest.ai](https://github.com/speechswitch/client/issues/24) | REST/SSE and live WebSocket | [TS](../sdk/providers/smallest.ai/index.ts) · [Python](python/speechswitch/providers/smallest_ai.py) · [Go](go/providers/smallest_ai/) · [Rust](rust/src/providers/smallest_ai/mod.rs) | [Fixture](fixtures/smallest.json) | `provider/smallest-polyglot` · `9b0eab9` |
| [#25 typecast](https://github.com/speechswitch/client/issues/25) | Ordinary, timestamped, streamed and composed HTTP | [TS](../sdk/providers/typecast/index.ts) · [Python](python/speechswitch/providers/typecast.py) · [Go](go/providers/typecast/) · [Rust](rust/src/providers/typecast/mod.rs) | [Fixture](fixtures/typecast.json) | `provider/typecast-polyglot` · `de88d5a` |
| [#26 vocu](https://github.com/speechswitch/client/issues/26) | Simple generation and async tasks | [TS](../sdk/providers/vocu/index.ts) · [Python](python/speechswitch/providers/vocu.py) · [Go](go/providers/vocu/) · [Rust](rust/src/providers/vocu/mod.rs) | [Fixture](fixtures/vocu.json) | `provider/vocu-polyglot` · `f1a6708` |
| [#27 voice.ai](https://github.com/speechswitch/client/issues/27) | Legacy synthesis and captured modern protocols | [TS](../sdk/providers/voice.ai/index.ts) · [Python](python/speechswitch/providers/voice_ai.py) · [Go](go/providers/voice_ai/) · [Rust](rust/src/providers/voice_ai/mod.rs) | [Fixture](fixtures/voice_ai.json) | `provider/voice-ai-polyglot` · `414cd0e` |
| [#28 xai](https://github.com/speechswitch/client/issues/28) | Byte HTTP, voice discovery and TTS WebSocket | [TS](../sdk/providers/xai/index.ts) · [Python](python/speechswitch/providers/xai.py) · [Go](go/providers/xai/) · [Rust](rust/src/providers/xai/mod.rs) | [Fixture](fixtures/xai.json) | `provider/xai-polyglot` · `3994c9b` |

Amazon is a separate, pre-existing TypeScript provider. Its foreign request types
and validators exist, but foreign adapters do not. It is not covered by issues
#3–#28. Do not advertise complete SDK parity, or silently count Amazon as implemented.

## Verified local gates and their limits

Both gates passed at `3994c9b`:

- `bun run check`: workspace TypeScript 7, schema checks, Bun tests, 263 Node
  tests, provider registry/spec/client freshness, all 250 generated foreign files,
  and playground type checking.
- `bun run check:languages`: all Rust/Go/Python compilation and tests, generated
  validator parity, shared provider/protocol fixtures, native loopback transport
  tests, and expected compiler diagnostics.

The [foreign-language check](../codegen/check-language-types.ts) runs the actual
language suites and exact negative-type assertions; it is not a file-presence
check. The [generator](../codegen/generate-language-types.ts) derives request,
output and validator code from `schemas/`. [Source catalog entries](../schemas/sources.yaml)
retain URLs, request methods/bodies where required, and snapshot hashes.

These gates do not prove live paid-provider acceptance, remote account/model
availability, identical timing across providers, or successful PR publication.
Rust protocol tests use injected backends; the standard library does not provide
TLS or an async executor. Native loopback coverage in Python/Go is not a live
authenticated provider run. Provider-specific caveats remain in [the SDK guide](README.md).

## Publication is incomplete

Read-only GitHub inspection found only these open PRs:

| PR | Head | Base |
| --- | --- | --- |
| [#30](https://github.com/speechswitch/client/pull/30) | `provider/xai-tts` | `redevelop` |
| [#31](https://github.com/speechswitch/client/pull/31) | `provider/deepgram-tts` | `provider/xai-tts` |
| [#56](https://github.com/speechswitch/client/pull/56) | `provider/async-tts-v2` | `provider/deepgram-tts` |
| [#57](https://github.com/speechswitch/client/pull/57) | `provider/camb-tts-v2` | `provider/async-tts-v2` |
| [#58](https://github.com/speechswitch/client/pull/58) | `provider/cartesia-tts-v2` | `provider/camb-tts-v2` |
| [#59](https://github.com/speechswitch/client/pull/59) | `provider/deepdub-tts-v2` | `provider/cartesia-tts-v2` |

No `*-polyglot` PR was returned by the all-state PR query. Existing early
TypeScript PRs are not evidence that the latest local provider/language work has
been submitted.

The stack contains blocked ancestor
`f336096e240f6c20f0aac769b1d6d89169e8a985`. The earlier GH013 rejection concerns a
signed AWS image URL in unchanged
`schemas/sources/elevenlabs/01-tts-websocket.html:1354`.
The repository owner must resolve the
[secret-scanning review](https://github.com/speechswitch/client/security/secret-scanning/unblock-secret/3IvAapmV6b4tglzOFYTbOHjB3Qo).
This audit did not retry a push or attempt a bypass.

Before declaring the overall goal complete:

1. Obtain the owner's resolution of the publication restriction.
2. Inspect the then-current remote refs and local branch ancestry; publish the
   intended provider-scoped stack without overwriting unrelated work.
3. Verify each PR's actual diff, base/head relationship, required checks and issue
   coverage. A local branch name or a green aggregate suite is insufficient.
4. Reconcile any remaining feature/model or transport mismatches found during
   provider-by-provider review. Keep live acceptance claims separate from fixture
   evidence.
5. Verify the requested precursor playground work and earlier review feedback are
   included in the final stack, not merely present in an unrelated local worktree.

Do not rewrite the blocked ancestor, modify preserved source snapshots, force-push,
or publish through an alternate API to evade the restriction.
