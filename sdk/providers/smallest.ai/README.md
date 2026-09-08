# Smallest.ai

Handwritten HTTP, SSE and WebSocket synthesis for `lightning-v3.1` and
`lightning-v3.1-pro`. The plain canonical request lives in
[`schemas/providers/smallest.ai/index.ts`](../../../schemas/providers/smallest.ai/index.ts).
TypeScript 7 generates request validation, playground model variants and
Rust/Python/Go request types from it. There is no handwritten parallel schema,
third-party runtime dependency, or vendor wire codegen.

## Usage

```ts
import { synthesize } from "./sdk/providers/smallest.ai/index.ts";

for await (const item of synthesize({
  model: "lightning-v3.1-pro",
  voice: "meher", // Or an existing cloned voice ID from this model's pool.
  text: "Hello from SpeechSwitch.",
  output: { format: "pcm", sampleRateHz: 24000 },
}, { auth: { "smallest.ai": { apiKey: "..." } } })) {
  if (item instanceof Uint8Array) {
    // Feed bytes to your consumer as they arrive.
  }
}
```

Authentication precedence is `auth["smallest.ai"].apiKey`,
`SPEECHSWITCH_SMALLEST_API_KEY`, then `SMALLEST_API_KEY`. Whole text defaults to
SSE; incremental input and word timestamps select WebSocket. Set
`transport: "http"` explicitly for the upstream non-streaming binary endpoint.
All paths still return one async audio stream; buffering belongs to the consumer.

Native WebSockets use an `Authorization: Bearer` upgrade header on Node 22.18+
and Bun, with optional `x-expire-content`. No API key is placed in the query or
subprotocol. Browser callers should use SSE or supply an already-authenticated
`webSocket`. An injected socket is exclusively owned and closed on completion,
failure, cancellation or iterator return. Configure an override's idle timeout and
headers before passing it; `idleTimeoutSeconds` applies to native construction.
Fetch and socket transports, URLs, abort signals and deadlines are injectable.

## Model and option boundaries

| Capability | Standard | Pro |
| --- | --- | --- |
| Normalized model | `lightning-v3.1` | `lightning-v3.1-pro` |
| Native model | `lightning_v3.1` | `lightning_v3.1_pro` |
| Explicit language codes | 20, plus `auto` | 31, plus `auto` |
| Existing cloned voice | From the standard pool | From the Pro pool |
| Whole text / streamed input | Both | Both |
| Word timestamps | Documented English/Hindi aligner families only | Same restriction |

Lightning v2 in the original issue is **retired**, not a supported model. The
[official changelog](https://docs.smallest.ai/models/changelog/lightning-v-3-1)
records its 410 responses. The current model cards and contracts supersede older
changelog entries about language routing. No attempt is made to revive dead v2
endpoints or silently substitute a model.

- Default output: mono signed 16-bit little-endian PCM at 44100 Hz. PCM, WAV,
  MP3, mulaw and alaw retain independent 8000/16000/24000/44100 sample-rate choices.
  Encoded formats reject PCM-only byte-order/sample-encoding options. Returned
  bytes retain native framing, including any per-chunk container framing.
- `speed` is a 0.5–2 multiplier. Untimed synthesis explicitly defaults `language`
  to `auto`, rather than native Pro omission's mixed English/Hindi selection.
  `numberPronunciationLanguage` remains independent because synthesis language is
  always sent explicitly. `formulaReading: "plain_text"` enables native math
  operator reading; `false` preserves ordinary number normalization.
- `pronunciationDictionaries: [{ id }]` selects existing dictionaries over
  HTTP/SSE; pinned versions and WebSocket dictionaries are not documented and are
  not invented. Creating dictionaries or cloning voices is outside synthesis.
- `contentRetentionDays: 7` opts enterprise requests into deletion after seven
  days. This is **not** zero-retention or model-training opt-out.
- `sessionId` and `requestId` are caller correlation labels, not audio/timestamp
  association keys. The latter uses the provider's generated `request_id`.
- Whole text is trimmed at the public boundary, then generated validation
  enforces non-whitespace input and the 8000-code-point maximum. Stream fragments
  preserve whitespace and are sent without look-ahead; no undocumented total
  stream or per-fragment text limit is fabricated.

Timestamp requests narrow `voice` to `meher`, `devansh`, `kartik`, `maithili`,
`liam` or `avery`, and `language` to `en`/`hi` (default `en`). Arbitrary catalog or
custom voices remain available in untimed variants. Word events preserve the
original text, native word index and seconds-to-milliseconds intervals. Audio and
timestamps are independent ordered envelopes with native synthesis `correlationId`;
there is no fabricated chunk pairing, character offset or global timeline offset.

## Incremental input and continuations

Ordinary `AsyncIterable<string>` uses legacy buffering, sends `continue: true`
fragments immediately and sends one final `flush: true` at input EOF. Its
`maxBufferDelayMs` (0–1000, default 0) and `completionDelayMs` (0–10000, default
4000) map to the documented native controls. A native `complete` before input
EOF fails instead of truncating the producer and reporting success. Empty input
completes locally without issuing empty synthesis requests. This mode does not
claim support for clear/update commands or midstream flushes.

Opt into prosody-preserving continuation mode with
`continuation: { id, maxBufferDelayMs? }`; its delay is 0–5000 (default 3000).
The authored union excludes legacy buffering knobs in this mode. Input permits
strings and `{ command: "clear" }`. The SDK sends the documented
`cancel_request: true` for that context and yields a **local** `{ event: "clear" }`.
It is not a server acknowledgment and does not promise cancellation of already
released/in-flight audio. Known older echoed external request IDs are dropped;
missing or unknown identity after clear fails rather than guessing freshness.
Hard-stop barge-in uses `AbortSignal` and a new synthesis call, plus clearing the
consumer's playback buffer.

Crucially, the [continuation protocol](https://docs.smallest.ai/models/documentation/text-to-speech-lightning/continuations)
has **no final context-complete event**. Every released segment has its own
`complete`; an empty closing frame can produce no response, and `context_id` is
not echoed. The SDK therefore exposes segment completions as
`{ event: "batch", requestId }`, sends `continue: false` at input EOF, and keeps
draining until the caller cancels/returns. This mode requires a signal or deadline.
Neither an idle interval, a socket close nor the first segment completion is
treated as a successful final `done`. Timeouts reject. Do not use `Array.fromAsync`
expecting a finite successful continuation result. Prefer ordinary streamed input
when a definitive final completion is required.

## Why no wire codegen

Twelve unchanged snapshots are recorded with URL, GET method and SHA-256 in
[`schemas/sources.yaml`](../../../schemas/sources.yaml). Issue #24 and all comments
were read (no comments). Its original generation recipe is superseded by the
repository's complete-contract requirement:

- AsyncAPI requires text and voice on every message, while context-close frames
  explicitly may omit both. It omits `cancel_request` and `output_format`, and
  leaves supported sample-rate choices in prose.
- Server status/data fields are optional and do not form valid discriminated
  response shapes; native errors are outside the reachable response enum.
- OpenAPI describes SSE as an opaque string and binary success as WAV despite
  documenting several output encodings. Model-specific language and alignment
  constraints are not expressed as structural variants.
- The official Fern overrides only rename/group endpoints. They do not repair
  these gaps. The Python SDK is a secondary framing reference, never a generation
  input or imported runtime dependency.

The adapter implements the wire protocol directly. The schema project still
generates specialized normalized request checks and foreign-language types.

## Verification and remaining scope

Tests cover exact wire payloads, native Node loopback HTTP/WebSocket auth,
incremental delivery, split SSE frames, independent timestamp association,
premature completion, continuation batches, clear identity handling, aborts,
deadlines, malformed frames, response ownership, model narrowing and playground
defaults. No credentialed live synthesis was run.

Rust, Python and Go compile generated request types for this provider and reject
Japanese on the standard model. Those languages currently have shared request and
output types plus injected streaming HTTP runtimes—not ported Smallest adapters,
WebSocket state machines, wire codecs or executable request validators.
