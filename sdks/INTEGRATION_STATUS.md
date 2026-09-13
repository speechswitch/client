# Integration inventory — 2026-09-13

All 26 requested integrations (#3–#28) have TypeScript, Python, Go and Rust adapters,
canonical schemas, generated validators, shared fixtures and published provider PRs.
Issue #28 is now closed following the merge of its TypeScript PR; the other 25
integration issues remain open. Every issue comment was reviewed: #28 requests
byte-native HTTP when incremental text input is unnecessary.

Later repository instructions supersede the original issues' codegen recipes:
partial or contradictory provider contracts require handwritten wire protocols.
Public request and output types and executable validation still derive from the
runtime-free TypeScript schemas. Raw definitions retain upstream URLs and hashes.

## Published provider inventory

Each native-language PR contains the Python, Go and Rust adapters for that provider.
The native stack starts at Mistral #86 on the validation foundation #85 and ends at
xAI #113; every native PR's base was checked against its predecessor's head branch.

| Issue / provider | TypeScript PR | Python / Go / Rust PR | Published native head |
| --- | --- | --- | --- |
| [#3 async](https://github.com/speechswitch/client/issues/3) | [#56](https://github.com/speechswitch/client/pull/56) | [#87](https://github.com/speechswitch/client/pull/87) | `dfec05d` |
| [#4 camb](https://github.com/speechswitch/client/issues/4) | [#57](https://github.com/speechswitch/client/pull/57) | [#88](https://github.com/speechswitch/client/pull/88) | `6fe6275` |
| [#5 cartesia](https://github.com/speechswitch/client/issues/5) | [#58](https://github.com/speechswitch/client/pull/58) | [#89](https://github.com/speechswitch/client/pull/89) | `345fb36` |
| [#6 deepdub](https://github.com/speechswitch/client/issues/6) | [#59](https://github.com/speechswitch/client/pull/59) | [#90](https://github.com/speechswitch/client/pull/90) | `5667a89` |
| [#7 deepgram](https://github.com/speechswitch/client/issues/7) | [#31](https://github.com/speechswitch/client/pull/31) | [#91](https://github.com/speechswitch/client/pull/91) | `d94c40b` |
| [#8 elevenlabs](https://github.com/speechswitch/client/issues/8) | [#61](https://github.com/speechswitch/client/pull/61) | [#92](https://github.com/speechswitch/client/pull/92) | `7009eb0` |
| [#9 fish](https://github.com/speechswitch/client/issues/9) | [#62](https://github.com/speechswitch/client/pull/62) | [#93](https://github.com/speechswitch/client/pull/93) | `af6ab91` |
| [#10 google](https://github.com/speechswitch/client/issues/10) | [#63](https://github.com/speechswitch/client/pull/63) | [#94](https://github.com/speechswitch/client/pull/94) | `bc3e03d` |
| [#11 gradium](https://github.com/speechswitch/client/issues/11) | [#64](https://github.com/speechswitch/client/pull/64) | [#95](https://github.com/speechswitch/client/pull/95) | `965940c` |
| [#12 hume](https://github.com/speechswitch/client/issues/12) | [#65](https://github.com/speechswitch/client/pull/65) | [#96](https://github.com/speechswitch/client/pull/96) | `44e7ff5` |
| [#13 inworld](https://github.com/speechswitch/client/issues/13) | [#67](https://github.com/speechswitch/client/pull/67) | [#97](https://github.com/speechswitch/client/pull/97) | `6343ae9` |
| [#14 kugelaudio](https://github.com/speechswitch/client/issues/14) | [#68](https://github.com/speechswitch/client/pull/68) | [#98](https://github.com/speechswitch/client/pull/98) | `a854fa3` |
| [#15 lovo](https://github.com/speechswitch/client/issues/15) | [#69](https://github.com/speechswitch/client/pull/69) | [#99](https://github.com/speechswitch/client/pull/99) | `68dc670` |
| [#16 microsoft](https://github.com/speechswitch/client/issues/16) | [#70](https://github.com/speechswitch/client/pull/70) | [#100](https://github.com/speechswitch/client/pull/100) | `e7af19d` |
| [#17 minimax](https://github.com/speechswitch/client/issues/17) | [#71](https://github.com/speechswitch/client/pull/71) | [#101](https://github.com/speechswitch/client/pull/101) | `bae0284` |
| [#18 mistral](https://github.com/speechswitch/client/issues/18) | [#72](https://github.com/speechswitch/client/pull/72) | [#86](https://github.com/speechswitch/client/pull/86) | `7f35889` |
| [#19 murf](https://github.com/speechswitch/client/issues/19) | [#73](https://github.com/speechswitch/client/pull/73) | [#102](https://github.com/speechswitch/client/pull/102) | `58a39f3` |
| [#20 openai](https://github.com/speechswitch/client/issues/20) | [#74](https://github.com/speechswitch/client/pull/74) | [#103](https://github.com/speechswitch/client/pull/103) | `2466457` |
| [#21 resemble](https://github.com/speechswitch/client/issues/21) | [#75](https://github.com/speechswitch/client/pull/75) | [#106](https://github.com/speechswitch/client/pull/106) | `d1a2f1d` |
| [#22 respeecher](https://github.com/speechswitch/client/issues/22) | [#77](https://github.com/speechswitch/client/pull/77) | [#107](https://github.com/speechswitch/client/pull/107) | `b7383ee` |
| [#23 rime](https://github.com/speechswitch/client/issues/23) | [#79](https://github.com/speechswitch/client/pull/79) | [#108](https://github.com/speechswitch/client/pull/108) | `f2a613d` |
| [#24 smallest.ai](https://github.com/speechswitch/client/issues/24) | [#80](https://github.com/speechswitch/client/pull/80) | [#109](https://github.com/speechswitch/client/pull/109) | `efc25af` |
| [#25 typecast](https://github.com/speechswitch/client/issues/25) | [#81](https://github.com/speechswitch/client/pull/81) | [#110](https://github.com/speechswitch/client/pull/110) | `299d810` |
| [#26 vocu](https://github.com/speechswitch/client/issues/26) | [#82](https://github.com/speechswitch/client/pull/82) | [#111](https://github.com/speechswitch/client/pull/111) | `0a42abe` |
| [#27 voice.ai](https://github.com/speechswitch/client/issues/27) | [#84](https://github.com/speechswitch/client/pull/84) | [#112](https://github.com/speechswitch/client/pull/112) | `49c8b71` |
| [#28 xai](https://github.com/speechswitch/client/issues/28) | [#30](https://github.com/speechswitch/client/pull/30) (merged) | [#113](https://github.com/speechswitch/client/pull/113) | `78d21cb` |

The provider guides under [sdk/providers](../sdk/providers/) and the
[foreign SDK guide](README.md) document protocol coverage, model combinations,
timestamp association, native controls and limits. Shared wire/output examples
are under [fixtures](fixtures/). Tests beside each adapter cover lifecycle behavior.

Amazon is a separate, pre-existing TypeScript provider. It has generated foreign
request types and validators but no Python, Go or Rust adapter. It is not one of
issues #3–#28; this inventory does not claim complete provider parity with TypeScript.

## Verification and limits

The published provider-stack tip `78d21cb` passed:

- `bun run check`: workspace TypeScript 7, 1759 Bun tests, 328 Node tests,
  registry/spec/client freshness, all 250 generated foreign files, and playground
  type checking.
- `bun run check:languages`: Rust/Python/Go compilation and tests, executable
  validator parity, shared protocol fixtures, native loopback transports,
  cancellation/lifecycle checks and exact expected compiler diagnostics.
- Focused xAI Python tests with strict Pyright, Rust tests, and Go's race detector.

The final shared audit passed these same gates after the naming migration. It canonicalizes
constraint ordering before hashing anonymous generated types and migrates authored
references by matching normalized type and union-variant identities. Constraint
reordering does not change model capabilities or wire payloads. Earlier fixes for
indexed request serialization, buffered cancellation and complete diagnostics remain
in their individual provider PRs.

This one-time normalization changes anonymous names in the ElevenLabs, Fish and
Google foreign modules. The migration matched 165 module/language layouts and 515
identifier mappings, including Go's sealed-union methods; no generated files were
hand-edited. Other provider names are preserved. Exact regression tests cover
equivalent ordering, changed bounds and absent optional constraint bags.

The shared Python audio reader now yields to queued cancellation even when an
injected transport returns already-buffered bytes without suspending. This extends
the provider-local fixes to every caller of that runtime. A regression checks both
nonempty and empty buffered chunks and single body cleanup.

Additional final checks passed: all 556 Python tests; Go's race detector across
all 26 provider packages and the runtime; and the playground production build.
The built Node server returned HTTP 200 for `/?provider=xai`; neither emitted
browser JavaScript bundle contains a `stdout._handle` reference. This smoke check
does not replace interactive browser or paid provider acceptance testing.

These checks do not prove paid live-provider acceptance, account/model availability,
identical timing across providers or hard remote inference/billing cancellation.
Native loopback tests are not authenticated provider acceptance tests. Rust uses
injected executor-independent HTTP/WebSocket/TLS backends; the standard library
does not provide those facilities. Python HTTP is injectable and Go supplies its
native HTTP transport. No third-party runtime dependency is shipped.

## Repository and earlier feedback

- [Playground prerequisite #60](https://github.com/speechswitch/client/pull/60) is
  merged, and its commit is an ancestor of this stack. Provider routing and form
  materialization remain covered by the Node tests.
- Rejected PRs #32–55 remain closed. Their replacements and the complete native
  stack are published; the earlier secret-scanning publication restriction no
  longer blocks those pushes. No bypass or history rewrite was used here.
- Remote #30, #31, #56, #104 and #105 have independent merge/base/head changes.
  This audit records their current state without force-pushing or replacing
  changes from other work.
- The original `/projects/client` checkout remains untouched on `provider/xai-tts`.
  Provider changes and this audit live in separate worktrees.
- Existing custom voices, native socket authentication, real clear/update/flush
  acknowledgments, automatic xAI language and all three latency levels are retained.
  Provider unions enforce model-specific options; shared base types do not become
  one exhaustive provider/model sum type.
