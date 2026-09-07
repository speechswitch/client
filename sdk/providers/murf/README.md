# Murf TTS

One `synthesize("murf", request, options)` operation returns an audio iterator.
The canonical `model` union determines which fields are available:

| Model / input | Native endpoint | Features |
| --- | --- | --- |
| `falcon-2` (default), string | `/v1/speech/stream` | Byte-native HTTP audio streaming |
| `falcon-2`, async iterable | `/v1/speech/stream-input` | Incremental text, context clear/flush, live settings |
| `gen2`, string | `/v1/speech/generate` | Duration, variation, word timings, inline zero-retention audio |

Murf deprecated Gen2 streaming on August 16, 2026. It remains in the raw
AsyncAPI enum, but is not advertised as a working incremental model here. The
older `falcon` / `gen-2` catalog labels are not silently treated as wire aliases.

```ts
import { synthesize } from "../../dispatch.ts";

async function* text() {
  yield "Hello!";
  yield { command: "update", voiceStyle: "Conversation", speedBias: 0 } as const;
  yield { command: "flush" } as const;
  yield "The next turn.";
  yield { command: "clear" } as const;
  yield "A replacement turn.";
}

for await (const event of synthesize("murf", {
  model: "falcon-2", voice: "Gordon", text: text(),
  output: { format: "pcm", sampleRateHz: 24000 },
})) {
  // Context-associated audio envelopes, clear/flush, and done.
}
```

`voice` accepts an existing provider voice identifier unchanged. Provisioned
custom IDs can be used when the account exposes them through synthesis. Creating
voice clones is an enterprise workflow, not a reference-audio field on these
endpoints. `voiceStyle` and `language` map to native style and locale; omission
leaves voice-specific selection to Murf, without inventing an `auto` wire value.

`speedBias` and `pitchBias` retain native integer scales (-50 to 50), with zero
neutral. Rate is not documented as a speed multiplier, so no percentage/multiplier
conversion is guessed. Gen2 `deliveryVariance` is the discrete normalized scale
0, 0.2, 0.4, 0.6, 0.8, 1, mapped exactly to native 0–5. `targetDurationMs` maps to
seconds; zero leaves duration unconstrained. Gen2 text may contain native pause
markup. No SSML wrapper is synthesized.

Integer settings and their bounds are authored in `schemas/providers/murf/index.ts`
and enforced by generated request and incremental-input checks, before invalid
values reach the wire. The same annotations generate Rust/Python/Go request types
and executable validators. Static text's 3000 UTF-16-unit limit is schema-owned;
incremental primitive strings retain the equivalent protocol check.

PCM is the default; rates default to 24 kHz for Falcon and 44.1 kHz for Gen2.
Seven native formats are retained separately from sample rate and channel count.
The first-party PCM playback example uses signed 16-bit samples. No unsupported
representation override is exposed, and OGG is not relabeled Vorbis or Opus
without evidence. Use WAV/MP3 for the current playground browser audio player.

## Streaming lifecycle

Incremental input preserves text exactly and uses explicit context IDs. Audio
envelopes carry `correlation: "ordered"` and their native context as `correlationId`;
each context is a separate audio stream/container, not an inferred timestamp range.

- `flush` sends `end: true`. Its flush event is emitted only after that context's
  native `final: true`. Later text creates a new context on the same socket.
- `clear` clears pending contexts, rotates the next context ID and emits local
  playback invalidation. This is **not a server acknowledgement**: Murf can finish
  already-started synthesis. Late audio/final messages for canceled contexts are
  discarded, and consumers should discard queued playback on the clear event.
- `update` changes voice, style, locale, rate, pitch or buffering. There is no
  documented update acknowledgement, so no `updated` event is fabricated.
- Buffering exposes the native integer character threshold (40–160) and maximum
  delay (0–1000 ms). Input exhaustion ends the current context and waits for all
  outstanding final messages. Input failures still escape a stalled flush.

Gen2 `timestampGranularity: "word"` produces timeline envelopes. CDN byte chunks
do not inherit guessed word association from their arrival order. Word times are
native milliseconds. Original-text alignment requires explicit English locale
and word timing in the provider union; normalized alignment is the default.

Gen2 defaults to downloading the native audio URL as bytes. `audioRetention: false`
requests native inline base64 audio without a retained audio file; the adapter
decodes it but still returns an iterator, never a second buffering operation.
CDN requests omit credentials, require HTTPS and reject redirects. Remaining
character count and warnings are retained on the done event.

## Configuration and contracts

Auth precedence: `auth.murf.apiKey`, `SPEECHSWITCH_MURF_API_KEY`, `MURF_API_KEY`.
Native Node/Bun sockets authenticate with the documented `api_key` header; browser
sockets use the documented query parameter. Keep production credentials on the
server. `webSocket` is an exclusive runtime/test override. `fetch`, `baseUrl`,
`webSocketUrl`, `signal` and `timeoutMs` are injectable boundary options. Proxy
paths and query parameters are preserved; fixed regional URLs may replace the
default global Falcon router. Consumer return closes input and transport without
waiting for uncooperative cleanup. No implicit retry repeats billed synthesis.

Twenty-one first-party snapshots are SHA-256 cataloged and were re-fetched on
September 7, 2026. Seventeen still matched; four documentation pages changed only
their signed image URLs. Their refreshed bytes are retained exactly with updated
hashes; the OpenAPI and AsyncAPI snapshots are unchanged. Wire code is
handwritten because OpenAPI models streaming audio as an empty JSON object,
AsyncAPI retains the deprecated Gen2 model and an invalid string/number default,
and the older Python SDK disagrees with current contracts on model names and
pronunciation dictionaries. Stale SDK-only pronunciation fields are not silently
promoted to supported current features. No specs are patched to enable codegen.

Canonical TypeScript generates validators, registry/spec, playground options,
and Rust/Python/Go request and output types. Murf's output contract now lives in
`schemas/providers/murf/index.ts`: only actual ordered/timeline correlation is
exposed, word ends and flush input-group IDs are required, and unsupported generic
chunk/source-offset fields are no longer advertised.

Python also has a handwritten HTTP/WebSocket adapter using those generated types
and checks; Go and Rust currently have generated Murf contracts, with adapters
planned on the same provider branch. Python accepts an injected HTTP transport
and creates native header-authenticated WebSockets, with an exclusive socket
override for tests. Use its `async with synthesize(...)` context for cancellation
and cleanup. Local clear events do not wait for a stalled native clear write;
flush acknowledgements require both the end write and native final to succeed.
JSON responses default to a 16 MiB cap and socket messages to 4 MiB.

Tests exercise real Node/Python WebSocket transports, shared exact wire/timing
fixtures, cancellation, model-conditioned materialization, generated validation
and foreign compilers. No paid Murf request was made.
