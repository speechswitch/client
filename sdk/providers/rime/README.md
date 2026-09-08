# Rime

Handwritten integration for Coda, Mist v3 and Mist v2. Whole text uses byte-native
HTTP; incremental text, requested timestamps, or explicit segmentation use the
preferred JSON WebSocket `/ws3`. The operation is always `synthesize`, returning
streamed output rather than collecting an utterance first.

```ts
import { synthesize } from "@speechswitch/router";

for await (const item of synthesize("rime", {
  model: "coda",
  voice: "astra", // or an existing enterprise-clone UUID
  text: "Hello from Rime.",
  output: { format: "pcm", sampleRateHz: 24000 },
})) {
  if (item instanceof Uint8Array) {
    // Play signed 16-bit little-endian PCM, incrementally.
  }
}
```

Authentication precedence is `auth.rime.apiKey`, `SPEECHSWITCH_RIME_API_KEY`, then
`RIME_API_KEY`. HTTP and native Node/Bun WebSockets send `Authorization: Bearer …`.
Keys never enter the connection query or subprotocol. Browser WebSockets cannot
set that header: use your backend, or inject an already-authenticated
`webSocket: WebSocketLike`. An override is exclusively owned and closed by this
call, and must already have the synthesis query configured. It never falls back
to a real network connection. `fetch`, `baseUrl` and `webSocketUrl` are injectable;
regional endpoints can be selected through the latter two. A WebSocket URL
includes the path; an HTTP base URL receives `/v1/rime-tts`.

## Models and normalized options

| Model | Languages | Preferred streaming formats | Inline controls |
| --- | --- | --- | --- |
| `coda` | en, es, fr, pt, de, ja, ar, hi, it | PCM, WAV, MP3, μ-law, Ogg Opus, WebM Opus | None |
| `mist-v3` | en, es, fr, de | Same as Coda | Pauses, span speeds; phonemes only in English |
| `mist-v2` | en, es, fr, de | PCM, MP3, μ-law | Pauses, span speeds, phonemes; normalization bypass |

Model is required and mapped explicitly to native `coda`, `mistv3`, or `mistv2`.
Never rely on Rime's omitted/unrecognized-model fallback (Mist v3). Language
defaults to `en`, not automatic detection: the chosen voice must support that
language and model. Mist v2 maps these normalized codes to its documented legacy
wire codes (`eng`, `spa`, `fra`, `ger`). Catalog and provisioned custom voices use the same `voice`
field. Clone creation is an enterprise provisioning process, not a synthesis
reference-audio option.

Output defaults to PCM: 24 kHz for modern models and 16 kHz for Mist v2. Rime's
`audio/L16` means **little-endian**, despite the usual MIME convention. Modern
sample rates are positive safe integers. Mist v2 rates are 4000–44100; MP3
defaults to 22050 and μ-law to 8000. Defaults are sent explicitly, so HTTP and
WebSocket do not silently choose different rates. PCM/WAV sample representation
is signed 16-bit LE, not float32. Formats are separate from sample rate.

`speed` is a multiplier, higher being faster. It maps to reciprocal
`timeScaleFactor` on modern models and reciprocal `speedAlpha` on Mist v2.
Modern speed is 0.4–2.5; values outside that range are rejected by the generated
validator instead of silently clamped. Mist v2 accepts positive speed whose
reciprocal can be represented finitely. Defaults are 1.

`textMarkup` groups opt-in interpretation of native inline syntax:

```ts
{
  model: "mist-v3",
  language: "en",
  voice: "cove",
  text: "Hi. <200> Say {k1Ast0xm} [quickly].",
  textMarkup: { pauses: true, phonemes: true, speeds: [2] },
}
```

`pauses` enables `<milliseconds>`, `phonemes` enables Rime phonetic strings in
`{...}`, and `speeds` gives positive speed multipliers for successive `[...]`
spans. Speeds map reciprocally to the comma-separated native `inlineSpeedAlpha`.
This is not SSML, IPA, or an adapter-side parser. General `textNormalization`
is independent, defaults to true, and can only be changed on Mist v2. The schema
rejects unsupported model/language combinations before network work. Per-stream
text-frame limits and finite reciprocal conversion checks remain protocol checks;
current schema annotations cannot bound an iterable's string items or individual
numeric array entries. Whole-text length is checked by generated validation.

## Incremental input and interruption

```ts
async function* text() {
  yield "Hello ";
  yield "there.";
  yield { command: "flush" } as const;
  yield { command: "clear" } as const;
  yield "Let's start again.";
}

const stream = synthesize("rime", {
  model: "coda", voice: "astra", text: text(),
  segmentation: "manual", timestampGranularity: "word",
});
```

`sentence` (default), `immediate`, and `manual` map to native `bySentence`,
`immediate`, and `never`. Text frames are sent as supplied without look-ahead;
empty strings are skipped. Whole text and each WebSocket text frame are limited
to 1000 Unicode code points. Input completion sends `eos`, which flushes remaining
text and closes the connection. Empty EOS may close without any audio or native
done event. Successful completion requires clean closure after EOS; a native
done alone cannot complete this iterator.

`flush` sends the native operation immediately. Empty flush produces no response;
busy flushes may coalesce. Native done becomes `{ event: "batch", inputGroupId? }`,
never a fabricated one-to-one flush acknowledgment. Intermediate sentence
boundaries do not necessarily produce native done. The final SDK
`{ event: "done" }` follows clean EOS closure, not the first completed batch.

**Native clear only discards unsent buffered text.** It does not cancel generation
already in flight or text queued by an earlier flush. The adapter also emits a
local playback-clear event and drops subsequent audio/timestamps/batch events
whose echoed context ID belongs to an older clear generation. This filtering is
only as strong as Rime's native context labeling; it is not a server cancellation
acknowledgment or proof that all preceding synthesis stopped. Unlabeled responses
after clear fail rather than being guessed fresh. For a hard stop, abort the
operation and start a new synthesis connection. There is no undocumented session
update/replacement operation.

`signal` and `timeoutMs` cover connection, producer waits and output reads. Abort,
protocol failure and consumer return release the connection and return unfinished
input once, without waiting forever for an uncooperative producer. HTTP responses
are canceled on early exit, errors or deadlines. No automatic retry can duplicate
speech or resume an ambiguous native batch.

## Timestamps: preserve uncertainty

Rime emits word timestamps only for English/Spanish. Other languages cannot request
them in the normalized type. Socket audio never waits for timestamp arrival.

Audio and timestamp events arrive independently. Envelopes use `correlation:
"ordered"`, `inputGroupId` for the echoed context label, and `timestampOrigin:
"synthesis"`. Seconds become milliseconds without accumulation or guessed offsets.
Native timestamps restart for each synthesis, but the protocol does not identify
every synthesis boundary; context IDs are mutable input labels, not unique
segment IDs. Consequently these values **cannot be placed on a global playback
timeline automatically**. No `correlationId`, audio time range, or chunk pairing
is invented from event order. Repeated timestamp origins are preserved even when
no native done separates them.

## Why no wire codegen?

Thirty-five unchanged source snapshots are cataloged with URL, GET method and
SHA-256. The embedded Mintlify endpoint objects have empty response contracts;
WebSocket connection parameters are misclassified as a GET JSON body. Model,
language, format and speed constraints are prose, not codified enums/bounds.
Mist v3's structured socket record omits both preferred `timeScaleFactor` and
English phoneme support. The MCP wrapper is not a substitute underlying contract.
`sources.test.ts` asserts these findings on the raw snapshots without executing
the embedded MDX. Only our authored normalized schema drives request validation,
registry/spec output, and Rust/Python/Go request-type generation.

Current feature guides take precedence over inconsistent legacy reference text:

- [WebSocket overview](https://docs.rime.ai/docs/websockets) and
  [streaming guide](https://docs.rime.ai/docs/streaming) recommend `/ws3` for all
  models, including Mist v2. The overview's trailing link table still points
  Mist v2 to legacy `/ws2`; an explicit socket URL can select that compatible
  JSON endpoint, but it is not the default.
- [Segmentation guide](https://docs.rime.ai/docs/websockets-segment) explains empty
  and coalesced flushes and the limited scope of native clear.
- [Pronunciation guide](https://docs.rime.ai/docs/custom-pronunciation) and
  [normalization guide](https://docs.rime.ai/docs/text-normalization) document
  English Mist v3 phonemes, which older model tables omit.
- [Speed guide](https://docs.rime.ai/docs/speed) distinguishes modern preferred
  time scaling from compatibility speedAlpha and per-span legacy direction.
- [Voice cloning](https://docs.rime.ai/platform/voice-cloning) documents existing
  UUID voice selection without a reference-audio synthesis field.

Legacy raw WebSocket, Mist v2 SSE and buffered JSON endpoints are preserved as
research snapshots, not exposed as additional synthesis operations. This PR
covers the issue's preferred HTTP and JSON WebSocket transports, without adding
slower alternatives or pretending legacy-only formats work on the preferred API.

Tests cover generated validation/model narrowing, unchanged-source hashes,
playground defaults, all documented preferred formats, native Node HTTP and
WebSocket auth, independent timestamps, coalesced/empty flushes, clear filtering,
malformed frames and cancellation cleanup. No live credentialed synthesis was
performed; protocol behavior is exercised using injected transports and loopback
servers.
